-- Reverts 0135 + 0136: the Non Responsive stage is removed entirely, per
-- user request — it added a Kanban column and a daily auto-flagging cron
-- they don't want. Every lead currently sitting in that stage was flagged
-- there straight from 'contacted' (confirmed via lead_activities'
-- stage_change history — all 1,116 of them came from that one stage, none
-- from replied/initial_contact/followup despite those also being eligible
-- source stages), so they move back there rather than needing a per-lead
-- guess or a fallback bucket.
update public.leads set stage = 'contacted' where stage = 'non_responsive';

select cron.unschedule('detect-non-responsive-leads');

alter table public.leads drop constraint if exists leads_stage_check;
alter table public.leads add constraint leads_stage_check check (stage in (
  'new', 'voicemail', 'contacted', 'replied', 'initial_contact',
  'followup', 'negotiation', 'contract', 'in_title', 'closed',
  'dead_declined', 'onhold', 'others'
));
