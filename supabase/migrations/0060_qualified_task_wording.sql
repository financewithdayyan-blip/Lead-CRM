-- Reword the two qualified-stage tasks to match how the business actually
-- talks about this step: follow up with the lead, then get the contract
-- signed — rather than the more literal "run the numbers" framing.
create or replace function public.handle_lead_qualified_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  qualified_stages text[] := array['initial_contact', 'followup', 'negotiation', 'contract'];
  was_qualified boolean := TG_OP = 'UPDATE' and OLD.stage = any(qualified_stages);
  is_qualified boolean := NEW.stage = any(qualified_stages);
  ai_just_paused boolean := TG_OP = 'UPDATE' and coalesce(OLD.ai_reply_paused, false) = false and NEW.ai_reply_paused = true;
  display_name text := coalesce(nullif(trim(NEW.first_name), ''), 'lead');
begin
  if is_qualified and not was_qualified and not ai_just_paused then
    insert into public.tasks (user_id, lead_id, title, due_date, auto_created)
    values
      (NEW.user_id, NEW.id, 'Follow up with ' || display_name || ' — confirm numbers and next steps', current_date, true),
      (NEW.user_id, NEW.id, 'Get the contract from ' || display_name || ' — send and follow up until signed', current_date, true);
  end if;
  return NEW;
end;
$$;

-- Reword the ones already sitting on qualified-plus leads to match, rather
-- than leaving old wording stranded until each lead's next transition.
update public.tasks
set title = 'Follow up with ' || coalesce(nullif(trim(split_part(split_part(title, 'Run the numbers for ', 2), ' — ARV', 1)), ''), 'lead') || ' — confirm numbers and next steps'
where title like 'Run the numbers for %';

update public.tasks
set title = 'Get the contract from ' || coalesce(nullif(trim(split_part(split_part(title, 'Send LOI or Contract to ', 2), ' once terms', 1)), ''), 'lead') || ' — send and follow up until signed'
where title like 'Send LOI or Contract to %';
