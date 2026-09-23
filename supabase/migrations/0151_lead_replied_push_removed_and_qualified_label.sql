-- Drop the lead-replied push (explicitly not wanted) added in 0150.
drop trigger if exists trg_lead_replied_push on public.leads;
drop function if exists public.handle_lead_replied_push();

-- The qualified-lead push always said the generic "Lead qualified" even
-- though the transition it fires on is really "first time entering
-- Partial Qualified or beyond" — almost always literally the Partial
-- Qualified stage, since that's the first of the four in normal flow, but a
-- manual drag can skip straight to Qualified/Negotiation/Contract. Title
-- now names whichever stage was actually just reached, matching
-- domain.ts's own STAGE_CONFIG labels, instead of assuming it's always
-- Partial Qualified.
create or replace function public.handle_lead_qualified_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  qualified_stages text[] := array['initial_contact', 'followup', 'negotiation', 'contract'];
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
