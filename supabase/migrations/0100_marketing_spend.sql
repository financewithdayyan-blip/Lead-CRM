-- Manual marketing spend log — nothing else in the CRM tracks acquisition
-- cost, so CAC / Cost Per Lead / Cost Per Deal have no possible data source
-- without this. Admin logs what was spent, on what source, over what
-- period; those KPIs get built once enough entries exist to mean something.
create table public.marketing_spend (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null,
  amount numeric not null,
  period_start date not null,
  period_end date not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.marketing_spend enable row level security;

-- Admin-only, same posture as contract_instances — any admin sees/manages
-- every entry, no per-user scoping.
create policy "marketing_spend_all" on public.marketing_spend
  for all using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
