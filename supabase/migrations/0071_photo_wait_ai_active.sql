-- Lets a Partial-Qualified lead (initial_contact — waiting only on photos)
-- keep getting AI replies, specifically so it can acknowledge photos or
-- schedule a callback, without reopening the full qualification framework.
--
-- ai_reply_paused stays true on the replied -> initial_contact transition,
-- unchanged — the qualified-tasks trigger (handle_lead_qualified_tasks)
-- relies on that exact flip to skip its own generic task pair. This column
-- is a second, narrower flag ai-reply checks alongside stage = 'initial_contact'
-- to decide whether IT specifically is still allowed to text this lead.
-- A human manually replying (useSendManualReply) clears it, which is what
-- actually silences the AI here — the stage itself never has to change just
-- because a human sent one message.
alter table public.leads
  add column photo_wait_ai_active boolean not null default false;
