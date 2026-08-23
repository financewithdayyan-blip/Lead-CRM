import raw from './usGeoCoords.json';
import { normalizeStateToCode } from './usGeo';

/** Same source as usGeo.ts, kept as a separate lazy-loaded file since it's
 *  only needed by the buyer map (~200KB gzipped for city coordinates —
 *  no reason to make the list view or the picker pay for it). */
interface UsGeoCoordsData {
  stateCentroids: Record<string, { lat: number; lng: number }>;
  citiesByState: Record<string, [name: string, lat: number, lng: number][]>;
}

const data = raw as unknown as UsGeoCoordsData;

export function stateCentroid(stateName: string): { lat: number; lng: number } | null {
  const code = normalizeStateToCode(stateName);
  return code ? (data.stateCentroids[code] ?? null) : null;
}

/** Best-effort city lookup: prefers a match within `preferStates` (a buyer's
 *  declared market states) since city names collide across states ("Dallas"
 *  exists in TX, GA, OR...); falls back to the first nationwide match when
 *  the city isn't in any of those, or when no state was declared at all. */
export function cityCoord(cityName: string, preferStates: string[] = []): { lat: number; lng: number } | null {
  const lower = cityName.trim().toLowerCase();
  if (!lower) return null;

  const preferCodes = preferStates.map(normalizeStateToCode).filter((c): c is string => !!c);
  for (const code of preferCodes) {
    const hit = data.citiesByState[code]?.find((c) => c[0].toLowerCase() === lower);
    if (hit) return { lat: hit[1], lng: hit[2] };
  }

  for (const code of Object.keys(data.citiesByState)) {
    const hit = data.citiesByState[code].find((c) => c[0].toLowerCase() === lower);
    if (hit) return { lat: hit[1], lng: hit[2] };
  }
  return null;
}

/** "City, ST" options for the map's search box — unlike the buy-box picker's
 *  bare city names, the map needs state-disambiguated labels since it's
 *  resolving to one specific point, not matching free text. */
export function cityStateOptions(): string[] {
  const out: string[] = [];
  for (const code of Object.keys(data.citiesByState)) {
    for (const [name] of data.citiesByState[code]) out.push(`${name}, ${code}`);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function resolveCityStateOption(label: string): { name: string; stateCode: string; lat: number; lng: number } | null {
  const idx = label.lastIndexOf(', ');
  if (idx === -1) return null;
  const name = label.slice(0, idx);
  const stateCode = label.slice(idx + 2);
  const hit = data.citiesByState[stateCode]?.find((c) => c[0] === name);
  return hit ? { name, stateCode, lat: hit[1], lng: hit[2] } : null;
}

const EARTH_RADIUS_MILES = 3958.8;

export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
