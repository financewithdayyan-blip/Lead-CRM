-- New Kanban stage: "Inspection & Walkthrough", sitting between Contract and
-- In Title — a lead that's under contract but not yet through the physical
-- inspection/walkthrough step. Admin-only, same as In Title/Closed (see
-- domain.ts's visibleStagesFor), since this is a post-contract deal-
-- management concern, not a calling/qualifying one.
alter table public.leads drop constraint if exists leads_stage_check;
alter table public.leads add constraint leads_stage_check check (stage in (
  'new', 'voicemail', 'contacted', 'replied', 'initial_contact',
  'followup', 'negotiation', 'contract', 'inspection_walkthrough', 'in_title', 'closed',
  'dead_declined', 'onhold', 'others'
));

-- stage_priority (0125) is a generated column, so it has to be dropped and
-- re-added rather than altered in place — same tier-1 "active pipeline
-- stage" bucket as contract/in_title/closed.
drop index if exists idx_leads_user_priority_num;
alter table public.leads drop column stage_priority;
alter table public.leads add column stage_priority smallint generated always as (
  case stage
    when 'replied' then 1
    when 'initial_contact' then 1
    when 'followup' then 1
    when 'negotiation' then 1
    when 'contract' then 1
    when 'inspection_walkthrough' then 1
    when 'in_title' then 1
    when 'closed' then 1
    when 'contacted' then 2
    when 'new' then 3
    when 'onhold' then 4
    when 'others' then 4
    when 'dead_declined' then 5
    else 4
  end
) stored;
create index idx_leads_user_priority_num on public.leads (user_id, stage_priority, lead_num);

-- handle_lead_qualified_push (0151) fires once the first time a lead enters
-- the qualified-or-beyond range, including a manual drag straight into a
-- later stage — Inspection & Walkthrough needs to be in that range too, or
-- a lead dragged directly into it (skipping Contract) would silently never
-- fire the "lead qualified" notification at all.
create or replace function public.handle_lead_qualified_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  qualified_stages text[] := array['initial_contact', 'followup', 'negotiation', 'contract', 'inspection_walkthrough'];
  was_qualified boolean := TG_OP = 'UPDATE' and OLD.stage = any(qualified_stages);
  is_qualified boolean := NEW.stage = any(qualified_stages);
  display_name text := coalesce(nullif(trim(coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, '')), ''), 'A lead');
  stage_label text;
begin
  if is_qualified and not was_qualified then
    stage_label := case NEW.stage
      when 'initial_contact' then 'Partial Qualified'
      when 'followup' then 'Qualified'
      when 'negotiation' then 'Negotiation'
      when 'contract' then 'Contract'
      when 'inspection_walkthrough' then 'Inspection & Walkthrough'
      else NEW.stage
    end;
    insert into public.lc_notifications (user_id, lead_id, type, title, body)
    values (
      NEW.user_id,
      NEW.id,
      'lead_qualified',
      display_name || ' reached ' || stage_label,
      display_name || coalesce(' — ' || nullif(NEW.address, ''), '')
    );
  end if;
  return NEW;
end;
$$;
