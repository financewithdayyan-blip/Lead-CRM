-- Distinguishes an AI/trigger-generated task from one an admin typed in by
-- hand — the auto-generated ones were flooding the notification bell (29 at
-- once from the qualified-tasks backfill alone), which belongs to a human's
-- own reminders, not a firehose of AI busywork. The Tasks dashboard card is
-- where those belong instead.
alter table public.tasks add column auto_created boolean not null default false;

-- Only the fallback path needs updating (Kanban drag, the profile's stage
-- dropdown, a call outcome) — ai-reply now creates its own single,
-- conversation-specific task directly, so this generic pair must not also
-- fire for that same update or a qualified-by-AI lead gets three tasks
-- instead of one. Detected via ai_reply_paused flipping true in the same
-- statement — only ai-reply's qualification branch ever does that alongside
-- the stage change; every other path only touches stage.
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
      (NEW.user_id, NEW.id, 'Run the numbers for ' || display_name || ' — ARV, repairs, and offer', current_date, true),
      (NEW.user_id, NEW.id, 'Send LOI or Contract to ' || display_name || ' once terms are agreed', current_date, true);
  end if;
  return NEW;
end;
$$;

-- Lets the Tasks dashboard card update live (new AI-created tasks appearing,
-- a completion toggled from elsewhere) without a manual refresh.
alter publication supabase_realtime add table public.tasks;
