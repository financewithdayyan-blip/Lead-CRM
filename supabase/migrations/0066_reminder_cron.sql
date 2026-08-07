-- Runs the reminder sweep once a day, inside the same 7pm-6am Pakistan
-- outreach window bulk sends use (14:00 UTC open) — these are replies to an
-- existing conversation, not cold outreach, so they're not gated by the
-- window server-side, but keeping the cron itself inside it avoids a stray
-- 3am text landing on someone in the wrong timezone.
--
-- Auth is the service role key stored in Vault (0065's follow-up — see that
-- migration's note; the key itself is never written to a migration file).
select cron.schedule(
  'send-daily-reminders',
  '0 15 * * *',
  $$
  select net.http_post(
    url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
