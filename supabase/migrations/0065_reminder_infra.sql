-- Infrastructure for daily lead-nudge reminders: pg_cron to run the sweep on
-- a schedule, pg_net so the cron job can call the send-reminders edge
-- function (same way every other automated Zoom send in this app works),
-- and the column that tracks when each lead is next due for one.
create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.leads add column next_reminder_at date;

comment on column public.leads.next_reminder_at is
  'When this lead is next due for an automated check-in reminder (Replied/Partial-Qualified stages). Null means not yet scheduled — the reminder sweep treats null as due now. Advances to tomorrow after each reminder, or to a specific date if the lead promised one (e.g. "I''ll send photos Friday").';
