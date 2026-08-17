-- ── Pipeline: In Title / Closed ──────────────────────────────────────────
-- Two post-contract stages so admins can track a deal through title work to
-- an actual close, instead of everything sitting in "Contract" until done.
alter table public.leads drop constraint if exists leads_stage_check;
alter table public.leads add constraint leads_stage_check check (stage in (
  'new', 'voicemail', 'contacted', 'replied', 'initial_contact',
  'followup', 'negotiation', 'contract', 'in_title', 'closed',
  'dead_declined', 'onhold', 'others'
));
