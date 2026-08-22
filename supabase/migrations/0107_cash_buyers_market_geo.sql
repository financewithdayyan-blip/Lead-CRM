-- ============================================================================
-- Buy-box geography gets two more granularities alongside the existing city
-- list (the `markets` column, kept as-is — renamed to marketCities only on
-- the TS side): a buyer can now also be tagged by state(s) and, informally,
-- by county(ies). Deal packets don't record a county today, so
-- market_counties is descriptive only (helps an admin eyeball a buyer's
-- range) and isn't used by buyerMatchesPacket; market_states IS matched
-- against a deal's state, widening a state-level buyer ("I'll buy anywhere
-- in Georgia") beyond city-exact matching.
-- ============================================================================

alter table public.cash_buyers add column market_states text[] not null default '{}';
alter table public.cash_buyers add column market_counties text[] not null default '{}';

create index cash_buyers_market_states_idx on public.cash_buyers using gin (market_states);
create index cash_buyers_market_counties_idx on public.cash_buyers using gin (market_counties);
