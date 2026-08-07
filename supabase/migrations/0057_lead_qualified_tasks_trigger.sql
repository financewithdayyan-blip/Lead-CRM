-- Auto-creates the "run the numbers" / "send LOI or Contract" tasks the
-- moment ANY lead enters a qualified-or-beyond stage, regardless of how it
-- got there — a Kanban drag, the stage dropdown on the lead profile, a call
-- outcome, or the AI's own qualification flow (ai-reply used to insert these
-- itself; moved here so every path is covered uniformly instead of only the
-- AI-driven one, and so it can never double-fire for the same transition).
--
-- SECURITY DEFINER: a Kanban drag is very often performed by an admin on a
-- lead owned by a different team member, and tasks_write only allows
-- inserting a task whose user_id matches the CALLER's own auth.uid() — a
-- plain (security invoker) trigger would hit that RLS check as the acting
-- user, not the lead's owner, and fail the insert, which aborts the whole
-- triggering transaction and would break the stage change itself.
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
  display_name text := coalesce(nullif(NEW.first_name, ''), 'lead');
begin
  if is_qualified and not was_qualified then
    insert into public.tasks (user_id, lead_id, title, due_date)
    values
      (NEW.user_id, NEW.id, 'Run the numbers for ' || display_name || ' — ARV, repairs, and offer', current_date),
      (NEW.user_id, NEW.id, 'Send LOI or Contract to ' || display_name || ' once terms are agreed', current_date);
  end if;
  return NEW;
end;
$$;

create trigger trg_lead_qualified_tasks
  after insert or update of stage on public.leads
  for each row
  execute function public.handle_lead_qualified_tasks();
