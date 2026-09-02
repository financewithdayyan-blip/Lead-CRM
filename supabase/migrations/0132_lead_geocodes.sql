-- Caches lead id -> lat/lng for the City Performance map's under-contract
-- property pins (CityZipMap). Same shape and trust boundary as
-- city_geocodes/zip_geocodes (0123/0124) — one shared team, not
-- multi-tenant, coordinates only, filled in lazily from the client the
-- first time the map hits an under-contract lead with no cached geocode
-- yet (see useUpsertLeadGeocode). Keyed by lead_id so a re-geocode just
-- overwrites if an address is ever corrected.
create table if not exists lead_geocodes (
  lead_id    uuid primary key references public.leads(id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  created_at timestamptz not null default now()
);

alter table lead_geocodes enable row level security;

create policy "lead_geocodes_select" on lead_geocodes
  for select to authenticated using (true);

create policy "lead_geocodes_insert" on lead_geocodes
  for insert to authenticated with check (true);
