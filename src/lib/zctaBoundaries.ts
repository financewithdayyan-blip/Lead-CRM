/**
 * Real zip-code (ZCTA) boundary polygons from the Census Bureau's TIGERweb
 * service — free, keyless, public domain. Geometry is asked back simplified
 * (maxAllowableOffset ~111m) specifically because the full-resolution
 * polygons are large enough to make a 20+-zip city (a real Tampa query)
 * take 30+ seconds — simplified, the same query lands in ~4s at a fraction
 * of the payload, and still reads correctly at the zoom level a city
 * drill-down actually renders at.
 *
 * Session-lifetime cache, same pattern as src/lib/geocode.ts, so
 * re-opening a city already viewed this session is instant.
 */

export type ZctaGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

const TIGERWEB_ZCTA_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query';
// ArcGIS query URLs get long fast with many zips in one IN(...) clause —
// chunking keeps each request comfortably under typical URL length limits
// and keeps any one request's response small and fast.
const CHUNK_SIZE = 40;

const cache = new Map<string, ZctaGeometry | null>();

async function fetchChunk(zips: string[]): Promise<Record<string, ZctaGeometry>> {
  const where = `ZCTA5 IN (${zips.map((z) => `'${z}'`).join(',')})`;
  const url = `${TIGERWEB_ZCTA_URL}?${new URLSearchParams({
    where,
    outFields: 'ZCTA5',
    f: 'geojson',
    outSR: '4326',
    geometryPrecision: '3',
    maxAllowableOffset: '0.001',
  })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TIGERweb returned ${res.status}`);
  const data = await res.json();
  const out: Record<string, ZctaGeometry> = {};
  for (const f of data?.features ?? []) {
    const zip = f?.properties?.ZCTA5;
    if (zip && f.geometry) out[zip] = f.geometry;
  }
  return out;
}

/** Resolves as many of the given zip5s to real boundary polygons as the
 * service returns — a zip TIGERweb has nothing for (or a failed request)
 * is simply absent from the result; callers should fall back to a plain
 * marker for those rather than treating it as an error. */
export async function fetchZctaBoundaries(zip5s: string[]): Promise<Map<string, ZctaGeometry>> {
  const result = new Map<string, ZctaGeometry>();
  const toFetch: string[] = [];
  for (const zip of zip5s) {
    if (cache.has(zip)) {
      const hit = cache.get(zip);
      if (hit) result.set(zip, hit);
    } else {
      toFetch.push(zip);
    }
  }
  if (toFetch.length === 0) return result;

  for (let i = 0; i < toFetch.length; i += CHUNK_SIZE) {
    const chunk = toFetch.slice(i, i + CHUNK_SIZE);
    try {
      const geometries = await fetchChunk(chunk);
      for (const zip of chunk) {
        const geom = geometries[zip] ?? null;
        cache.set(zip, geom);
        if (geom) result.set(zip, geom);
      }
    } catch {
      // Best-effort — this chunk's zips just fall back to markers.
    }
  }
  return result;
}
