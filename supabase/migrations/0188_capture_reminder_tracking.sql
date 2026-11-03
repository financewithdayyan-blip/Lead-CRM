-- Supports two new automated texts around the guided photo capture flow:
--   1. A confirmation SMS to the seller the moment complete-capture-session
--      fires (every photo actually made it in).
--   2. A "didn't finish" nudge for a session that got partway (at least one
--      photo uploaded, status 'in_progress') and then went quiet — sent by
--      a new cron sweep, send-capture-reminders.
--
-- last_activity_at is bumped by submit-capture-photo on every photo
-- upload, so the sweep can tell "still actively taking photos" apart from
-- "stalled/abandoned partway" instead of just going off session age.
-- reminder_sent_at stops the sweep from re-texting the same stalled
-- session every time it runs.
alter table public.photo_capture_sessions add column if not exists last_activity_at timestamptz not null default now();
alter table public.photo_capture_sessions add column if not exists reminder_sent_at timestamptz;

-- Secret set once, by hand, on both sides, never in a migration file (same
-- pattern as onhold_followup_cron_secret — see 0129's own comment on why
-- this isn't just the service role key):
--   select vault.create_secret('<random-string>', 'send_capture_reminders_cron_secret');
--   supabase secrets set SEND_CAPTURE_REMINDERS_CRON_SECRET=<same-random-string> --project-ref ggfpvrdxqopippzqkojr
--
-- Runs every 15 minutes; the function itself only acts on sessions stale
-- past 45 minutes of inactivity, so worst-case the nudge goes out roughly
-- 45-60 minutes after the seller's last photo.
select cron.schedule(
  'send-capture-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/send-capture-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'send_capture_reminders_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
