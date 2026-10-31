-- Hardens two cron-triggered functions' auth, following the same
-- purpose-made-secret pattern already proven by ai-reply-review (0077),
-- bulk-sms-dispatcher (0085), and send-onhold-followups (0129):
--
-- send-reminders (0066) compared the caller's bearer directly against
-- SUPABASE_SERVICE_ROLE_KEY in function code — the same fragile pattern
-- 0129's own comment documents as already broken twice in this project (the
-- key can drift format between what Vault stores and what a deployed
-- function sees at runtime, silently 401ing the cron forever with no
-- alert). It's dual-use (cron AND the admin's own session from the Kanban
-- "Send Reminder Messages" button), so verify_jwt stays true and the
-- existing Authorization header is left alone — only an additional
-- x-internal-secret header is added, which supabase/functions/send-reminders
-- now checks first before falling back to the real admin-JWT check.
--
-- sync-sms-delivery-stats (0112) had no real authorization check in code at
-- all — verify_jwt=true was doing all the work, but that's satisfied by the
-- public anon key just as much as a real service-role token, so any caller
-- holding the (client-embedded) anon key could trigger it freely. It's
-- cron-only (confirmed: nothing in the frontend ever calls it), so this
-- moves it to the same no-admin-JWT-path pattern as send-onhold-followups:
-- verify_jwt=false (see supabase/config.toml), x-internal-secret only.
--
-- Both supabase/functions/send-reminders and
-- supabase/functions/sync-sms-delivery-stats were redeployed alongside this
-- migration to check these headers. Secrets set once, by hand, on both
-- sides, never in a migration file:
--   select vault.create_secret('<random-hex>', 'send_reminders_cron_secret');
--   supabase secrets set SEND_REMINDERS_CRON_SECRET=<same-random-hex> ...
--   select vault.create_secret('<random-hex>', 'sync_sms_delivery_stats_cron_secret');
--   supabase secrets set SYNC_SMS_DELIVERY_STATS_CRON_SECRET=<same-random-hex> ...
--
-- cron.schedule with an existing job name replaces its definition in place
-- (same idiom 0085/0087/0129 already rely on), so this doesn't need an
-- unschedule step first.
select cron.schedule(
  'send-daily-reminders',
  '0 15 * * *',
  $$
  select net.http_post(
    url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'send_reminders_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'sync-sms-delivery-stats',
  '0 */3 * * *',
  $$
  select net.http_post(
    url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/sync-sms-delivery-stats',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_sms_delivery_stats_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
