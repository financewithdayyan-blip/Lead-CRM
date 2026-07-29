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

async function geocodeOne(address: string): Promise<GeoPoint | null> {
  const key = address.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;

  try {
    const url = `${ENDPOINT}?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Geocoder returned ${res.status}`);
    const rows = (await res.json()) as { lat: string; lon: string }[];
    const hit = rows[0]
      ? { lat: parseFloat(rows[0].lat), lng: parseFloat(rows[0].lon) }
      : null;
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

    // Nominatim resolves "123 Main St" far better with a city and state on it.
    const query = cityStateHint && !row.address.includes(',')
      ? `${row.address}, ${cityStateHint}`
      : row.address;

    if (requested > 0) await sleep(1100);
    const point = await geocodeOne(query);
    requested++;

    out.push(point ? { ...row, lat: point.lat, lng: point.lng } : row);
  }

  return out;
}
