-- ── Leads table server-side pagination: pipeline-priority ordering ─────────
-- Drives the ORDER BY for the new paginated Leads table query so leads that
-- matter most surface on page 1 instead of raw creation order: active
-- pipeline stages first, then Contacted, then Cold, then On Hold/Others, and
-- Dead/Declined last. `voicemail` is dead (board removed from the workflow,
-- constraint/type just never cleaned up) so it falls into the tier-4 default.
alter table public.leads add column stage_priority smallint generated always as (
  case stage
    when 'replied' then 1
    when 'initial_contact' then 1
    when 'followup' then 1
    when 'negotiation' then 1
    when 'contract' then 1
    when 'in_title' then 1
    when 'closed' then 1
    when 'contacted' then 2
    when 'new' then 3
    when 'onhold' then 4
    when 'others' then 4
    when 'dead_declined' then 5
    else 4
  end
) stored;

create index idx_leads_user_priority_num on public.leads (user_id, stage_priority, lead_num);
