-- Caches 5-digit zip code -> lat/lng for the City Performance map's
-- zip-level drill-down (click a city, see which zip codes inside it are
-- actually converting). Resolved offline from a bundled US zip database at
-- backfill time (no free-geocoder rate limits involved, unlike
-- city_geocodes) — see the one-off backfill script run alongside this
-- migration. Grows lazily from the client for any zip not yet cached (see
-- useZipGeocodes), same pattern as city_geocodes.

create table if not exists zip_geocodes (
  zip5       text primary key,
  city       text not null,
  state      text not null,
  lat        double precision not null,
  lng        double precision not null,
  created_at timestamptz not null default now()
);

alter table zip_geocodes enable row level security;

create policy "zip_geocodes_select" on zip_geocodes
  for select to authenticated using (true);

create policy "zip_geocodes_insert" on zip_geocodes
  for insert to authenticated with check (true);
