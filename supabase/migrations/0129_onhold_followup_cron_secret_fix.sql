-- Fixes migration 0128's cron auth: it used the service-role key stored in
-- Vault as a Bearer JWT, the same pattern send-daily-reminders (0066) uses.
-- That pattern has a known, already-documented failure mode in this exact
-- project — see 0077's comment: the service role key can rotate formats
-- between what's stored in Vault and what deployed edge functions actually
-- see via SUPABASE_SERVICE_ROLE_KEY, silently 401ing the job forever with
-- no alert anywhere. That's exactly what happened here: this cron has never
-- successfully authenticated since it was created earlier today. Confirmed
-- by hand-triggering the function with the same Vault-stored key and
-- getting {"error":"Not signed in."} back.
--
-- Fix: move to the same purpose-made-secret + x-internal-secret pattern
-- already proven working by ai-reply-review (0077) and bulk-sms-dispatcher
-- (0085) — a secret that isn't tied to Supabase's own key rotation at all.
-- supabase/functions/send-onhold-followups/index.ts was redeployed
-- alongside this migration (--no-verify-jwt, since auth is no longer a
-- Supabase JWT) to check this header instead of comparing against
-- SUPABASE_SERVICE_ROLE_KEY. Secret set once, by hand, on both sides, never
-- in a migration file:
--   select vault.create_secret('<random-string>', 'onhold_followup_cron_secret');
--   supabase secrets set ONHOLD_FOLLOWUP_CRON_SECRET=<same-random-string> ...
--
-- cron.schedule with an existing job name replaces its definition in place
-- (same idiom 0085/0087 already rely on), so this doesn't need an
-- unschedule step first.
select cron.schedule(
  'send-onhold-followups',
  '0 15 * * *',
  $$
  select net.http_post(
    url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/send-onhold-followups',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'onhold_followup_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
