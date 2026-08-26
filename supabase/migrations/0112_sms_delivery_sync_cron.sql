-- Runs the SMS delivery-stats sync every 3 hours — frequent enough for the
-- dashboard chart to feel current without hammering Zoom's API. Same auth
-- pattern as send-daily-reminders (0066): the service role key from Vault as
-- a real Bearer token, since sync-sms-delivery-stats has verify_jwt = true.
select cron.schedule(
  'sync-sms-delivery-stats',
  '0 */3 * * *',
  $$
  select net.http_post(
    url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/sync-sms-delivery-stats',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
