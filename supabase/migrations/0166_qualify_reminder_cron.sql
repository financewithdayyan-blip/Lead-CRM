-- Runs send-qualify-reminders every 15 minutes — fine-grained enough to
-- track the +1h/+3h/+6h tier within a reasonable margin, far coarser than
-- bulk-sms-dispatcher's 1-minute cadence since nothing here needs that.
--
-- Secret is inserted once, by hand, never in a migration file (same
-- convention as 0092/0128's own secrets):
--   select vault.create_secret('<random-string>', 'qualify_reminder_cron_secret');
-- and the edge function also needs the same value set as its own secret:
--   supabase secrets set QUALIFY_REMINDER_CRON_SECRET=<same value>
select cron.schedule(
  'send-qualify-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/send-qualify-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'qualify_reminder_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
