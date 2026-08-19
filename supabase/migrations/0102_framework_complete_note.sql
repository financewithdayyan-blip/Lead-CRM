-- Auto-post a readable summary note when a lead's Qualification Framework
-- (leads.script_answers) transitions from incomplete to fully complete —
-- fires on every write path (call session, AI auto-reply) since it's a
-- trigger on the leads table itself, not duplicated app-side logic.
--
-- The step/question list mirrors src/lib/callScript.ts exactly (including
-- the Mortgage step only applying to Lis Pendens/Pre-Foreclosure/Foreclosure/
-- Auction leads, same as LIEN_TAG_NAMES there) — if that file's questions
-- ever change, update framework_steps() here to match.

create or replace function public.framework_steps(p_has_mortgage boolean)
returns jsonb
language sql
immutable
as $$
  select (
    '[
      {"title":"Confirmation","questions":[
        {"key":"confirmation_owner","prompt":"Are you the owner of the property, or someone who can speak for them?"}
      ]},
      {"title":"Motivation","questions":[
        {"key":"motivation_owned","prompt":"How long have you owned it?"},
        {"key":"motivation_reason","prompt":"What''s the motivation for you to sell?"}
      ]},
      {"title":"Condition","questions":[
        {"key":"condition_general","prompt":"Tell me a bit more about the condition of your property."},
        {"key":"condition_rating","prompt":"What would you rate it out of 10 if you were in my shoes?"},
        {"key":"condition_issues","prompt":"Any major issues that I should know about?"},
        {"key":"condition_hvac","prompt":"What about HVAC?"},
        {"key":"condition_plumbing","prompt":"Is Plumbing PVC or Iron Cast?"},
        {"key":"condition_roof","prompt":"How old is the Roof?"}
      ]},
      {"title":"Timeline","questions":[
        {"key":"timeline","prompt":"When would you like to close? Is there a specific date you are working toward?"}
      ]},
      {"title":"Price","questions":[
        {"key":"price_asking","prompt":"What are you hoping to get for the property?"},
        {"key":"price_reasoning","prompt":"How did you arrive at that number?"}
      ]}
    ]'::jsonb
    ||
    case when p_has_mortgage then
      '[{"title":"Mortgage","questions":[
        {"key":"mortgage_payment","prompt":"What''s your monthly mortgage payment?"},
        {"key":"mortgage_balance","prompt":"What''s the total remaining balance owed on the mortgage?"},
        {"key":"mortgage_rate","prompt":"What''s your interest rate?"},
        {"key":"mortgage_statement","prompt":"Could you email a copy of your mortgage statement to dayyan@bluebirdacquisition.com?"}
      ]}]'::jsonb
    else '[]'::jsonb end
    ||
    '[
      {"title":"Decision","questions":[
        {"key":"decision","prompt":"Is anyone else involved in making the decision?"}
      ]},
      {"title":"Photo Request","questions":[
        {"key":"photo_request","prompt":"Great, I really appreciate your time today. So our team can evaluate the property properly, could you send a few photos of the interior and exterior? You can send them to me — any photos of interior and exterior from your phone work great."}
      ]},
      {"title":"Callback","questions":[
        {"key":"callback","prompt":"When is a good time to call you back?"}
      ]}
    ]'::jsonb
  );
$$;

create or replace function public.framework_is_complete(p_answers jsonb, p_has_mortgage boolean)
returns boolean
language plpgsql
immutable
as $$
declare
  v_step jsonb;
  v_q jsonb;
begin
  for v_step in select * from jsonb_array_elements(public.framework_steps(p_has_mortgage))
  loop
    for v_q in select * from jsonb_array_elements(v_step->'questions')
    loop
      if trim(coalesce(p_answers->>(v_q->>'key'), '')) = '' then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

create or replace function public.framework_summary(p_answers jsonb, p_has_mortgage boolean)
returns text
language plpgsql
immutable
as $$
declare
  v_step jsonb;
  v_q jsonb;
  v_out text := '';
begin
  for v_step in select * from jsonb_array_elements(public.framework_steps(p_has_mortgage))
  loop
    v_out := v_out || E'\n' || (v_step->>'title') || E'\n';
    for v_q in select * from jsonb_array_elements(v_step->'questions')
    loop
      v_out := v_out || '- ' || (v_q->>'prompt') || ' — '
        || coalesce(nullif(trim(p_answers->>(v_q->>'key')), ''), '(no answer)') || E'\n';
    end loop;
  end loop;
  return trim(both E'\n' from v_out);
end;
$$;

create or replace function public.log_framework_complete()
returns trigger
language plpgsql
as $$
declare
  v_has_mortgage boolean;
begin
  if new.script_answers is distinct from old.script_answers then
    select exists (
      select 1 from public.lead_tags lt
      join public.tags t on t.id = lt.tag_id
      where lt.lead_id = new.id
        and lower(t.name) in ('lis pendens', 'pre-foreclosure', 'foreclosure', 'auction')
    ) into v_has_mortgage;

    if public.framework_is_complete(new.script_answers, v_has_mortgage)
       and not public.framework_is_complete(old.script_answers, v_has_mortgage) then
      insert into public.lead_activities (lead_id, user_id, type, body)
      values (
        new.id,
        new.user_id,
        'note',
        'Qualification Framework completed:' || E'\n' || public.framework_summary(new.script_answers, v_has_mortgage)
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger leads_log_framework_complete after update on public.leads
  for each row execute function public.log_framework_complete();
