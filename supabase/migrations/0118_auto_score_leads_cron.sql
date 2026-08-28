-- Schedules auto-score-leads twice a week — Monday and Thursday, 09:00 UTC,
-- same reasoning as ai-reply-review's own timing (0077): well outside the
-- 14:00-01:00 UTC cold-outreach window so it never competes with a real
-- send for Zoom/DB/Anthropic capacity, and early enough in the admin's day
-- that fresh scores are ready before the morning's first calls.
--
-- Mirrors contract-reminder-sweep (0092) exactly: a purpose-made Vault
-- secret (never the service role key), an x-internal-secret header,
-- standard 5-field cron syntax with a day-of-week list.
--
-- Secret is inserted once, by hand, never in a migration file:
--   select vault.create_secret('<random-string>', 'auto_score_cron_secret');
select cron.schedule(
  'auto-score-leads',
  '0 9 * * 1,4',
  $$
  select net.http_post(
    url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/auto-score-leads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'auto_score_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
