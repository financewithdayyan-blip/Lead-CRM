-- ============================================================================
-- Lets a "deal bought" entry be assigned directly from a real lead currently
-- in the Contract stage, instead of only ever being free-typed. Nullable and
-- ON DELETE SET NULL — the deals-bought record is a sales-history record
-- that should survive the source lead being deleted or exported/purged later
-- (same reasoning as send_log.lead_id / inbound_messages.lead_id).
-- ============================================================================

alter table public.buyer_deals add column lead_id uuid references public.leads(id) on delete set null;

create index buyer_deals_lead_id_idx on public.buyer_deals (lead_id);
