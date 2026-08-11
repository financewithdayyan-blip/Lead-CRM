-- Runs the AI reply self-review nightly, well outside the 14:00-01:00 UTC
-- cold-outreach window so it never competes with a real send for Zoom/DB
-- capacity. pg_cron/pg_net already enabled by 0065.
--
-- Auth is a purpose-made secret in Vault ('ai_review_cron_secret'), not the
-- service role key send-daily-reminders (0066) used — that key has since
-- rotated formats between what's stored in Vault and what deployed edge
-- functions actually see, which would make this job 401 forever with no
-- way to notice. This secret was set once, deliberately, on both sides.
select cron.schedule(
  'ai-reply-review',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/ai-reply-review',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ai_review_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
