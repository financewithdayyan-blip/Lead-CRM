-- ============================================================================
-- Stores the send config (templates, sending number, daily limit) a bulk job
-- was started with, so a stalled/failed job can be resumed against only its
-- still-queued leads without the admin having to retype the message or risk
-- re-selecting leads that already got sent to.
-- ============================================================================

alter table public.bulk_sms_jobs add column config jsonb;
