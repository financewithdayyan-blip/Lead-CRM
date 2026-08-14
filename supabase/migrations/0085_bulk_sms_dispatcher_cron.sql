-- Schedules bulk-sms-dispatcher to run every minute — this is the process
-- that actually drives a bulk SMS send to completion server-side, with no
-- browser tab involved. See supabase/functions/bulk-sms-dispatcher/index.ts
-- for the full reasoning (in particular why this is a completely separate
-- function rather than send-sms chaining itself, which caused a real
-- incident on 2026-08-10).
--
-- Mirrors 0077_ai_reply_review_cron.sql exactly: a purpose-made Vault
-- secret (never the service role key — see that migration's own comment on
-- the format-drift risk), an x-internal-secret header, standard 5-field
-- cron syntax (every existing cron job in this project uses this; pg_cron
-- 1.6.4 is confirmed installed and does support sub-minute interval
-- scheduling, but that's deliberately deferred to a future, lower-risk
-- follow-up rather than being the first use of unproven syntax here).
--
-- Secret is inserted once, by hand, never in a migration file:
--   select vault.create_secret('<random-string>', 'bulk_sms_dispatch_secret');
select cron.schedule(
  'bulk-sms-dispatcher',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/bulk-sms-dispatcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bulk_sms_dispatch_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
