-- Time-based push reminders: a scheduled callback (10 and 5 minutes
-- before), a task's due time, and a lead's next-follow-up time. Unlike
-- 0150/0151's stage-transition triggers, these can't fire from a table
-- trigger — nothing updates a row at T-minus-10-minutes, so a lead/task
-- sitting untouched still has to get reminded. Needs a periodic sweep.
--
-- Every existing pg_cron job in this codebase (bulk-sms-dispatcher,
-- contract-reminder-sweep, ai-reply-review, ...) calls out to an edge
-- function via net.http_post because their actual work needs an external
-- API (Twilio/Zoom/SMTP). This sweep's only job is deciding who's due and
-- inserting into lc_notifications — both pure SQL — so it skips the edge
-- function/vault-secret/net.http_post layer entirely and just calls a plain
-- SQL function directly from cron. The existing trg_lc_notification_push
-- trigger (0144) picks up each insert and sends the actual push exactly
-- like every other notification type.
--
-- Dedup is "claim while you read": each due-reminder branch is a WITH
-- UPDATE ... RETURNING CTE that stamps its own *_sent_for column in the
-- same statement that finds the row, so two overlapping sweeps (shouldn't
-- happen at a 1-minute cadence, but not load-bearing on that assumption)
-- can never double-send. Comparing against the *_sent_for value (not just a
-- sent boolean) means rescheduling a callback/task/follow-up to a new time
-- naturally re-arms its reminder with no separate reset trigger needed.

alter table public.leads
  add column if not exists callback_reminder_10_sent_for timestamptz,
  add column if not exists callback_reminder_5_sent_for timestamptz,
  add column if not exists followup_reminder_sent_for date;

alter table public.tasks
  add column if not exists due_reminder_sent_for_date date,
  add column if not exists due_reminder_sent_for_time time;

create or replace function public.claim_and_push_due_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  today_pkt date := (now() at time zone 'Asia/Karachi')::date;
  hour_pkt int := extract(hour from now() at time zone 'Asia/Karachi');
begin
  -- ── Scheduled callback, 10 minutes before ───────────────────────────────
  with claimed as (
    update leads
    set callback_reminder_10_sent_for = scheduled_callback_at
    where scheduled_callback_at is not null
      and scheduled_callback_at > now_ts
      and scheduled_callback_at - interval '10 minutes' <= now_ts
      and callback_reminder_10_sent_for is distinct from scheduled_callback_at
    returning id, user_id, first_name, last_name, scheduled_callback_note
  )
  insert into lc_notifications (user_id, lead_id, type, title, body)
  select
    user_id,
    id,
    'call_reminder_10',
    'Call in 10 minutes',
    coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'A lead')
      || coalesce(' — ' || nullif(scheduled_callback_note, ''), '')
  from claimed;

  -- ── Scheduled callback, 5 minutes before ────────────────────────────────
  with claimed as (
    update leads
    set callback_reminder_5_sent_for = scheduled_callback_at
    where scheduled_callback_at is not null
      and scheduled_callback_at > now_ts
      and scheduled_callback_at - interval '5 minutes' <= now_ts
      and callback_reminder_5_sent_for is distinct from scheduled_callback_at
    returning id, user_id, first_name, last_name, scheduled_callback_note
  )
  insert into lc_notifications (user_id, lead_id, type, title, body)
  select
    user_id,
    id,
    'call_reminder_5',
    'Call in 5 minutes',
    coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'A lead')
      || coalesce(' — ' || nullif(scheduled_callback_note, ''), '')
  from claimed;

  -- ── Task due, 10 minutes before (only tasks with a specific due_time) ───
  with claimed as (
    update tasks
    set due_reminder_sent_for_date = due_date, due_reminder_sent_for_time = due_time
    where completed = false
      and due_date is not null
      and due_time is not null
      and (due_date + due_time) > now_ts
      and (due_date + due_time) - interval '10 minutes' <= now_ts
      and (due_reminder_sent_for_date is distinct from due_date or due_reminder_sent_for_time is distinct from due_time)
    returning user_id, lead_id, title
  )
  insert into lc_notifications (user_id, lead_id, type, title, body)
  select user_id, lead_id, 'task_due', 'Task due in 10 minutes', title
  from claimed;

  -- ── Task due today, no specific time (reminded once, from 8am PKT) ──────
  with claimed as (
    update tasks
    set due_reminder_sent_for_date = due_date
    where completed = false
      and due_date is not null
      and due_time is null
      and due_date <= today_pkt
      and hour_pkt >= 8
      and due_reminder_sent_for_date is distinct from due_date
    returning user_id, lead_id, title
  )
  insert into lc_notifications (user_id, lead_id, type, title, body)
  select user_id, lead_id, 'task_due', 'Task due today', title
  from claimed;

  -- ── Follow-up due, 10 minutes before (only ones with a specific time) ───
  with claimed as (
    update leads
    set followup_reminder_sent_for = next_follow_up
    where next_follow_up is not null
      and next_follow_up_time is not null
      and (next_follow_up + next_follow_up_time) > now_ts
      and (next_follow_up + next_follow_up_time) - interval '10 minutes' <= now_ts
      and followup_reminder_sent_for is distinct from next_follow_up
    returning id, user_id, first_name, last_name
  )
  insert into lc_notifications (user_id, lead_id, type, title, body)
  select
    user_id,
    id,
    'followup_due',
    'Follow-up in 10 minutes',
    coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'A lead')
  from claimed;

  -- ── Follow-up due today, no specific time (reminded once, from 8am PKT) ─
  with claimed as (
    update leads
    set followup_reminder_sent_for = next_follow_up
    where next_follow_up is not null
      and next_follow_up_time is null
      and next_follow_up <= today_pkt
      and hour_pkt >= 8
      and followup_reminder_sent_for is distinct from next_follow_up
    returning id, user_id, first_name, last_name
  )
  insert into lc_notifications (user_id, lead_id, type, title, body)
  select
    user_id,
    id,
    'followup_due',
    'Follow-up due today',
    coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'A lead')
  from claimed;
end;
$$;

revoke all on function public.claim_and_push_due_reminders() from public;

select cron.schedule('push-reminder-sweep', '* * * * *', $$select public.claim_and_push_due_reminders();$$);
