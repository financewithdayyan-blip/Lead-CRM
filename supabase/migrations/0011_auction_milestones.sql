-- Tracks which auction countdown milestones (20/10/7 days out) have already
-- surfaced a follow-up reminder for a lead, so each one only notifies once.
alter table public.leads add column auction_milestones_notified jsonb not null default '[]'::jsonb;
