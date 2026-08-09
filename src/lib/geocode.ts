/**
 * Address → coordinates via OpenStreetMap's Nominatim.
 *
 * Free and keyless, but it is a volunteer-run service with a usage policy: at
 * most one request per second and no bulk work. So this is only ever called
 * admin-side when a packet is saved, results are stored on the row, and the
 * public packet page never geocodes anything no matter how many people open it.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/** Session-lifetime cache so re-saving a packet doesn't re-request known addresses. */
const cache = new Map<string, GeoPoint | null>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Splits "4202 Woodlynne Lane, Orlando, FL 32812" into its structured parts.
 * Nominatim resolves a specific house number far more reliably against
 * structured street/city/state/postalcode params than against one freeform
 * string — a plain `q=` search commonly falls back to a road-level match
 * (or nothing at all), which is how two different house numbers on the same
 * street were landing on the exact same point on the map. */
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

async function nominatimSearch(params: Record<string, string>): Promise<GeoPoint | null> {
  const url = `${ENDPOINT}?${new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'us', ...params })}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geocoder returned ${res.status}`);
  const rows = (await res.json()) as { lat: string; lon: string }[];
  return rows[0] ? { lat: parseFloat(rows[0].lat), lng: parseFloat(rows[0].lon) } : null;
}

async function geocodeOne(address: string, cityStateHint?: string): Promise<GeoPoint | null> {
  const key = `${address.trim().toLowerCase()}|${cityStateHint ?? ''}`;
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;

  const { street, city, state, postalcode } = parseAddressParts(address, cityStateHint);

  try {
    // First attempt: full structured address, including house number.
    let hit = await nominatimSearch({
      street,
      ...(city ? { city } : {}),
      ...(state ? { state } : {}),
      ...(postalcode ? { postalcode } : {}),
    });

    // Fallback: the exact house number has no interpolation data in OSM for
    // that street often enough to matter — drop it and keep just the street
    // name, which still lands on the right block instead of producing no
    // pin at all.
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

    cache.set(key, hit);
    return hit;
  } catch {
    // A failed lookup is not worth failing a save over — the row simply has no
    // pin and the map skips it.
    cache.set(key, null);
    return null;
  }
}

/**
 * Geocodes a list of addresses one per second, in order. Entries already
 * carrying coordinates are passed straight through untouched.
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
    const point = await geocodeOne(row.address, cityStateHint);
    requested++;

    out.push(point ? { ...row, lat: point.lat, lng: point.lng } : row);
  }

  return out;
}
