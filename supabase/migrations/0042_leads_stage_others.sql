-- ── Pipeline: Others ─────────────────────────────────────────────────────
-- A catch-all board for leads that don't fit anywhere else in the pipeline
-- for miscellaneous reasons, moved there manually rather than by any
-- automated flow.
alter table public.leads drop constraint if exists leads_stage_check;
alter table public.leads add constraint leads_stage_check check (stage in (
  'new', 'voicemail', 'contacted', 'replied', 'initial_contact',
  'followup', 'negotiation', 'contract', 'dead_declined', 'onhold', 'others'
));
