-- Daily cron for detect-non-responsive-leads (migration 0135). Same
-- purpose-made-secret + x-internal-secret pattern as send-onhold-followups
-- post-fix (0129) and bulk-sms-dispatcher (0085) — never a service-role-key
-- comparison, which has a known silent-401 failure mode in this project.
-- Secret created once, by hand, in Vault and as this function's own secret,
-- never in a migration file:
--   select vault.create_secret('<random-hex>', 'non_responsive_cron_secret');
--   supabase secrets set NON_RESPONSIVE_CRON_SECRET=<same-random-hex> ...
select cron.schedule(
  'detect-non-responsive-leads',
  '30 15 * * *',
  $$
  select net.http_post(
    url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/detect-non-responsive-leads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'non_responsive_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
