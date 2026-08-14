-- Blue Docs overhaul, phase 1c — schedules contract-reminder-sweep every 30
-- minutes. Mirrors 0085_bulk_sms_dispatcher_cron.sql exactly: a purpose-made
-- Vault secret (never the service role key), an x-internal-secret header,
-- standard 5-field cron syntax.
--
-- A reminder sweep doesn't need the 1-minute cadence bulk-sms-dispatcher
-- runs at — the cadence logic itself (0091) only ever fires a reminder 24h+
-- after invite, so running this every 30 min instead of every minute costs
-- nothing in practice and is 30x less load for no real difference in when a
-- signer actually gets nudged.
--
-- Secret is inserted once, by hand, never in a migration file:
--   select vault.create_secret('<random-string>', 'contract_reminder_secret');
select cron.schedule(
  'contract-reminder-sweep',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/contract-reminder-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'contract_reminder_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
