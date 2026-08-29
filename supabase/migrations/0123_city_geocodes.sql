-- Caches city+state -> lat/lng for the dashboard's city performance map.
-- Geocoding hits free rate-limited providers (Census/Nominatim/Photon, see
-- src/lib/geocode.ts) — with 400+ distinct lead cities, re-geocoding on
-- every dashboard load would be slow and abusive of those services. This
-- table is populated once via a backfill for every city already in the
-- leads table, and grows lazily from the client as brand-new cities show up
-- (see useUpsertCityGeocode).

create table if not exists city_geocodes (
  city_key   text not null,
  state_key  text not null,
  city       text not null,
  state      text not null,
  lat        double precision not null,
  lng        double precision not null,
  created_at timestamptz not null default now(),
  primary key (city_key, state_key)
);

alter table city_geocodes enable row level security;

-- Not per-user data — every authenticated CRM user reads and contributes to
-- the same shared city cache.
create policy "city_geocodes_select" on city_geocodes
  for select to authenticated using (true);

create policy "city_geocodes_insert" on city_geocodes
  for insert to authenticated with check (true);
