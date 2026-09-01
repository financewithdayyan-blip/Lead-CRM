-- Runs the On Hold nurture sweep once a day, inside the same 7pm-6am
-- Pakistan outreach window bulk sends use (14:00 UTC open) — same reasoning
-- as 0066_reminder_cron.sql: these are continuations of an existing
-- conversation, not cold outreach, so they're not gated by the window
-- server-side, but keeping the cron inside it avoids a stray 3am text
-- landing on someone in the wrong timezone.
--
-- Auth is the service role key stored in Vault, same as every other cron
-- in this project (see 0065/0066's note — the key itself is never written
-- to a migration file).
select cron.schedule(
  'send-onhold-followups',
  '0 15 * * *',
  $$
  select net.http_post(
    url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/send-onhold-followups',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
