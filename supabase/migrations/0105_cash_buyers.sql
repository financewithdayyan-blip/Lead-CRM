-- ============================================================================
-- Disposition — a shared cash-buyers roster the whole admin team reads and
-- writes, not owned per-caller the way leads are (buyers aren't anyone's
-- individual pipeline). Same flat admin-wide RLS shape as blog_posts (0081):
-- one "for all" policy keyed off current_role(), no is_team_overseer/owner
-- column needed.
--
-- Buy-box fields are all optional/array-based on purpose — a buyer with no
-- price ceiling, or who buys in any condition, is common, and every field
-- here is a filter an admin applies when matching a deal, not a required
-- intake field.
-- ============================================================================

create table public.cash_buyers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,

  -- Buy box.
  markets text[] not null default '{}',          -- cities/metro areas they buy in
  property_types text[] not null default '{}',   -- subset of BUYER_PROPERTY_TYPES (src/types/domain.ts)
  price_min numeric,
  price_max numeric,
  min_beds numeric,
  min_baths numeric,
  condition text check (condition is null or condition in ('fixer', 'turnkey', 'either')),
  deal_types text[] not null default '{}',        -- subset of DealType: cash, subject_to, novation, creative

  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cash_buyers_markets_idx on public.cash_buyers using gin (markets);
create index cash_buyers_property_types_idx on public.cash_buyers using gin (property_types);
create index cash_buyers_deal_types_idx on public.cash_buyers using gin (deal_types);
create index cash_buyers_status_idx on public.cash_buyers (status);

alter table public.cash_buyers enable row level security;

create policy "cash_buyers_all" on public.cash_buyers
  for all using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
