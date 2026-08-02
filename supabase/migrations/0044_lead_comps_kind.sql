-- Mirrors packet_comps' kind/sale_date columns so a comp entered once on the
-- lead can be imported into a Deal Packet with its sold/listing distinction
-- and sale date intact, instead of losing that context on the round trip.
alter table public.lead_comps add column if not exists kind text not null default 'sold' check (kind in ('sold', 'listing'));
alter table public.lead_comps add column if not exists sale_date date;
