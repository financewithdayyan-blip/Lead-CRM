-- city_geocodes, zip_geocodes, and lead_geocodes (0123/0124/0132) were all
-- created with only select+insert RLS policies, but the client writes to
-- them via upsert(..., { onConflict: ... }) — an INSERT ... ON CONFLICT DO
-- UPDATE under the hood. Postgres RLS requires an UPDATE policy to satisfy
-- the on-conflict branch, so any upsert that actually hits an existing row
-- (the SAME city/zip/lead geocoded a second time — e.g. a stale client-side
-- cache that hasn't picked up a just-written row yet) was silently rejected
-- with 403 "new row violates row-level security policy". Went unnoticed for
-- city/zip (low collision odds, small distinct counts) until lead_geocodes
-- started seeing it constantly — confirmed in the browser console as
-- repeated 403s on ".../lead_geocodes?on_conflict=lead_id" once the City
-- Performance map started geocoding every partial-qualified/qualified/
-- negotiation/contract property (many more addresses, much higher chance of
-- re-hitting an already-cached one before the query cache refetches).
create policy "city_geocodes_update" on city_geocodes
  for update to authenticated using (true) with check (true);

create policy "zip_geocodes_update" on zip_geocodes
  for update to authenticated using (true) with check (true);

create policy "lead_geocodes_update" on lead_geocodes
  for update to authenticated using (true) with check (true);
