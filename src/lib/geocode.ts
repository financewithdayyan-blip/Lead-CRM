/**
 * Address → coordinates. Three providers, tried in order:
 *
 * 1. The US Census Bureau's geocoder — free, keyless, no rate limit, and
 *    built specifically on US TIGER/Line address ranges, so it resolves a
 *    real house number correctly far more often than a general-purpose
 *    geocoder does (which tends to fall back to a same-named street
 *    elsewhere in the metro, landing miles from the real spot).
 * 2. OpenStreetMap's Nominatim, only as a fallback for whatever the Census
 *    geocoder can't find (new construction not yet in TIGER, non-standard
 *    addresses) — a volunteer-run service with a real usage policy: at most
 *    one request per second, no bulk work.
 * 3. Photon (Komoot), only as a fallback for whatever Nominatim can't find —
 *    free, keyless, and built on the same OSM data but a different, fuzzier
 *    matching engine, so it occasionally resolves an address Nominatim's
 *    stricter structured search misses. Not a fix for addresses no OSM
 *    contributor has mapped yet, but a genuinely independent second attempt
 *    against the same dataset.
 *
 * Only ever called admin-side when a packet is saved; results are stored on
 * the row, and the public packet page never geocodes anything itself.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

const CENSUS_ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const PHOTON_ENDPOINT = 'https://photon.komoot.io/api/';

/** Session-lifetime cache so re-saving a packet doesn't re-request known addresses. */
const cache = new Map<string, GeoPoint | null>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Splits "4202 Woodlynne Lane, Orlando, FL 32812" into its structured parts
 * for Nominatim's fallback attempt. */
function parseAddressParts(address: string, cityStateHint?: string) {
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  const street = parts[0] ?? address.trim();
  let city: string | undefined;
  let state: string | undefined;
  let postalcode: string | undefined;

  if (parts.length >= 3) {
    city = parts[1];
    const stateZip = parts[parts.length - 1].match(/^([A-Za-z]{2})\s*(\d{5}(-\d{4})?)?$/);
    if (stateZip) {
      state = stateZip[1];
      postalcode = stateZip[2];
    } else {
      state = parts[parts.length - 1];
    }
  } else if (parts.length === 2) {
    const stateZip = parts[1].match(/^([A-Za-z]{2})\s*(\d{5}(-\d{4})?)?$/);
    if (stateZip) {
      state = stateZip[1];
      postalcode = stateZip[2];
    } else {
      city = parts[1];
    }
  }

  if ((!city || !state) && cityStateHint) {
    const [hintCity, hintState] = cityStateHint.split(',').map((s) => s.trim());
    city = city ?? hintCity;
    state = state ?? hintState;
  }

  return { street, city, state, postalcode };
}

async function censusGeocode(fullAddress: string): Promise<GeoPoint | null> {
  const url = `${CENSUS_ENDPOINT}?${new URLSearchParams({
    address: fullAddress,
    benchmark: 'Public_AR_Current',
    format: 'json',
  })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Census geocoder returned ${res.status}`);
  const data = await res.json();
  const match = data?.result?.addressMatches?.[0];
  if (!match?.coordinates) return null;
  return { lat: Number(match.coordinates.y), lng: Number(match.coordinates.x) };
}

async function nominatimSearch(params: Record<string, string>): Promise<GeoPoint | null> {
  const url = `${NOMINATIM_ENDPOINT}?${new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'us', ...params })}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geocoder returned ${res.status}`);
  const rows = (await res.json()) as { lat: string; lon: string }[];
  return rows[0] ? { lat: parseFloat(rows[0].lat), lng: parseFloat(rows[0].lon) } : null;
}

async function nominatimFallback(address: string, cityStateHint?: string): Promise<GeoPoint | null> {
  const { street, city, state, postalcode } = parseAddressParts(address, cityStateHint);

  let hit = await nominatimSearch({
    street,
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(postalcode ? { postalcode } : {}),
  });

  // The exact house number often has no interpolation data for that street —
  // drop it and keep just the street name, landing on the right block
  // instead of producing no pin at all.
  if (!hit) {
    const streetNameOnly = street.replace(/^\s*\d+[a-zA-Z]?\s+/, '').trim();
    if (streetNameOnly && streetNameOnly !== street) {
      await sleep(1100);
      hit = await nominatimSearch({
        street: streetNameOnly,
        ...(city ? { city } : {}),
        ...(state ? { state } : {}),
        ...(postalcode ? { postalcode } : {}),
      });
    }
  }

  return hit;
}

/** Photon only returns coordinates for a real address match if it can also
 * tell it's in the US — otherwise a loose fuzzy match can land overseas. */
async function photonFallback(query: string): Promise<GeoPoint | null> {
  const url = `${PHOTON_ENDPOINT}?${new URLSearchParams({ q: query, limit: '1', lang: 'en' })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Photon geocoder returned ${res.status}`);
  const data = await res.json();
  const feature = data?.features?.[0];
  const coords = feature?.geometry?.coordinates;
  if (!coords || feature?.properties?.countrycode !== 'US') return null;
  return { lat: Number(coords[1]), lng: Number(coords[0]) };
}

/** Geocodes one address, trying the Census geocoder first, then Nominatim,
 * then Photon, each only if the previous one comes back empty. Exported
 * directly (not just via geocodeAddresses) for one-off lookups like the
 * subject property's own coordinates. */
export async function geocodeAddress(address: string, cityStateHint?: string): Promise<GeoPoint | null> {
  const key = `${address.trim().toLowerCase()}|${cityStateHint ?? ''}`;
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;

  const query = cityStateHint && !address.includes(',') ? `${address}, ${cityStateHint}` : address;

  let hit: GeoPoint | null = null;
  try {
    hit = await censusGeocode(query);
  } catch {
    hit = null;
  }

  if (!hit) {
    try {
      hit = await nominatimFallback(address, cityStateHint);
    } catch {
      hit = null;
    }
  }

  if (!hit) {
    try {
      await sleep(1100);
      hit = await photonFallback(query);
    } catch {
      hit = null;
    }
  }

  cache.set(key, hit);
  return hit;
}

/**
 * Geocodes a list of addresses in order, spaced out for Nominatim's rate
 * limit on whichever ones fall through to it. Entries already carrying
 * coordinates are passed straight through untouched.
 */
export async function geocodeAddresses<T extends { address: string | null; lat?: number | null; lng?: number | null }>(
  rows: T[],
  cityStateHint?: string,
): Promise<T[]> {
  const out: T[] = [];
  let requested = 0;

  for (const row of rows) {
    if (!row.address || (row.lat != null && row.lng != null)) {
      out.push(row);
      continue;
    }

    if (requested > 0) await sleep(1100);
    const point = await geocodeAddress(row.address, cityStateHint);
    requested++;

    out.push(point ? { ...row, lat: point.lat, lng: point.lng } : row);
  }

  return out;
}
