-- Runs sms-backfill's recover_orphaned_outbound mode every 15 minutes on a
-- rolling 1-hour lookback (4x overlap margin over the 15-minute cadence,
-- same reasoning as 0166's own cron) — catches a text sent directly from the
-- Zoom app that strands in inbound_messages (sms-webhook's sentFromOwnNumber
-- branch failing on its own: a resolveLead error, a transient DB issue) and
-- recovers it into the thread automatically, without needing an admin to
-- open Settings and click Recover. The one-time full-history sweep (no
-- sinceHours) stays manual via Settings' SMS History Recovery card — this
-- cron is only the ongoing, going-forward safety net.
--
-- Secret is inserted once, by hand, never in a migration file (same
-- convention as 0092/0128/0166's own secrets):
--   select vault.create_secret('<random-string>', 'sms_orphan_recovery_cron_secret');
-- and the edge function also needs the same value set as its own secret:
--   supabase secrets set SMS_ORPHAN_RECOVERY_CRON_SECRET=<same value>
select cron.schedule(
  'sms-orphan-recovery',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/sms-backfill',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sms_orphan_recovery_cron_secret')
    ),
    body := jsonb_build_object('mode', 'recover_orphaned_outbound', 'commit', true, 'sinceHours', 1),
    timeout_milliseconds := 120000
  );
  $$
);
