-- Adds an optional time-of-day alongside the existing date-only fields, so
-- the Dashboard's calendar strip can show a real time for manually created
-- tasks and a lead's Next Follow-Up, the same way a scheduled call already
-- has one (scheduled_callback_at is a full timestamptz). Nullable — an
-- existing or new task/follow-up with no time set just renders as an
-- all-day entry on its date, same as Google Calendar's own all-day events.
alter table public.tasks
  add column due_time time;

alter table public.leads
  add column next_follow_up_time time;
