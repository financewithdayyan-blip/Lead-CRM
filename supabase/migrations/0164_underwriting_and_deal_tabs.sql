-- Underwriting tab: comps gain a third kind (as-is sold comps — distressed/
-- investor sales, distinct from a regular retail sold comp and from an
-- active listing), plus itemized $ repair line items at the lead level
-- (mirrors deal_packets' packet_repairs, same RLS shape as lead_comps/
-- lead_files in 0001_init.sql).
alter table public.lead_comps drop constraint lead_comps_kind_check;
alter table public.lead_comps add constraint lead_comps_kind_check check (kind in ('sold', 'listing', 'as_is'));

create table public.lead_repairs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  item text not null default '',
  cost numeric not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index lead_repairs_lead_id_idx on public.lead_repairs (lead_id);

alter table public.lead_repairs enable row level security;
create policy "lead_repairs_select" on public.lead_repairs
  for select using (exists (select 1 from public.leads l where l.id = lead_id and (l.user_id = auth.uid() or public.is_team_overseer(l.user_id))));
create policy "lead_repairs_write" on public.lead_repairs
  for all using (exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid()))
  with check (exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid()));

-- Deal tab: offer terms line + an 8-item title/closing checklist (boolean
-- done/not-done per item, matching exactly what's pictured — no in-progress
-- state). Contract status itself is NOT a new column — it's read live from
-- the real Blue Docs contract_instances/contract_signing_parties tables.
alter table public.leads
  add column if not exists offer_terms text,
  add column if not exists title_checklist jsonb not null default '{}'::jsonb;
