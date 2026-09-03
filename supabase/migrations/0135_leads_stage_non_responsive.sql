-- New pipeline stage: non_responsive. Auto-detected daily
-- (detect-non-responsive-leads) for a lead in contacted/replied/
-- initial_contact/followup whose last outbound text has sat unanswered 20+
-- days, so it's easy to find and try a different sending number for
-- (SmsThreadTab's "Switch number" control). A reply promotes it straight
-- back to 'replied' (see sms-webhook's ADVANCE_FROM) rather than staying
-- pinned like On Hold — this stage is meant to be temporary.
alter table public.leads drop constraint if exists leads_stage_check;
alter table public.leads add constraint leads_stage_check check (stage in (
  'new', 'voicemail', 'contacted', 'replied', 'initial_contact',
  'followup', 'negotiation', 'contract', 'in_title', 'closed',
  'dead_declined', 'non_responsive', 'onhold', 'others'
));
