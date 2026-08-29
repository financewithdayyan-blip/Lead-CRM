/**
 * City/place boundary polygons from the Census Bureau's TIGERweb service —
 * same free, keyless, public-domain infrastructure zctaBoundaries.ts
 * already relies on for zip codes. Tries Incorporated Places first (real
 * cities/towns), then Census Designated Places (unincorporated communities
 * — common for smaller towns) for anything not found there.
 *
 * Batched per state rather than per city: TIGERweb's place names collide
 * constantly across states (19 different "Buffalo"s alone), so every query
 * needs a state filter anyway — grouping by state turns N city requests
 * into (number of distinct states) requests instead.
 */

export type PlaceGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

// Standard FIPS state numeric codes — stable, publicly documented,
// never renumbered. Needed because TIGERweb's STATE field is FIPS, not the
// two-letter postal codes leads are stored with.
const STATE_FIPS: Record<string, string> = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10',
  DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19',
  KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27',
  MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35',
  NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44',
  SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53',
  WV: '54', WI: '55', WY: '56', PR: '72',
};

const TIGERWEB_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer';
const INCORPORATED_PLACES_LAYER = 28;
const CDP_LAYER = 30;
// A single hung request must never block every other state's results —
// each state runs independently (see below), so one timeout only costs
// that state's cities their boundaries, not the whole map's.
const FETCH_TIMEOUT_MS = 8000;

const cache = new Map<string, PlaceGeometry | null>();
const key = (city: string, state: string) => `${city.trim().toLowerCase()}|${state.trim().toUpperCase()}`;

async function queryLayer(layer: number, fips: string, names: string[]): Promise<Map<string, PlaceGeometry>> {
  const inList = names.map((n) => `'${n.replace(/'/g, "''").toUpperCase()}'`).join(',');
  const url = `${TIGERWEB_BASE}/${layer}/query?${new URLSearchParams({
    where: `STATE='${fips}' AND UPPER(BASENAME) IN (${inList})`,
    outFields: 'BASENAME',
    f: 'geojson',
    outSR: '4326',
    geometryPrecision: '4',
    // A small village can be just a couple miles across — the 0.002 offset
    // used for zip codes (much bigger polygons) was coarse enough to
    // collapse a place that size into degenerate, self-intersecting rings,
    // which is exactly what produced a single city rendering as a fill
    // covering the entire map. Finer offset, still small/fast per request.
    maxAllowableOffset: '0.0004',
  })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`TIGERweb places layer ${layer} returned ${res.status}`);
  const data = await res.json();
  const out = new Map<string, PlaceGeometry>();
  for (const f of data?.features ?? []) {
    const name = f?.properties?.BASENAME;
    if (name && f.geometry) out.set(name.toLowerCase(), f.geometry);
  }
  return out;
}

async function resolveState(fips: string, group: { city: string; state: string }[]): Promise<Map<string, PlaceGeometry>> {
  const names = group.map((c) => c.city.trim());
  let found: Map<string, PlaceGeometry>;
  try {
    found = await queryLayer(INCORPORATED_PLACES_LAYER, fips, names);
  } catch {
    found = new Map();
  }
  const stillMissing = group.filter((c) => !found.has(c.city.trim().toLowerCase()));
  if (stillMissing.length > 0) {
    try {
      const cdpFound = await queryLayer(CDP_LAYER, fips, stillMissing.map((c) => c.city.trim()));
      for (const [k, v] of cdpFound) found.set(k, v);
    } catch {
      // best-effort — these fall back to markers
    }
  }
  return found;
}

/** Resolves as many of the given city+state pairs to real boundary polygons
 * as TIGERweb has — a city genuinely not found in either layer is simply
 * absent from the result; callers should fall back to a plain marker for
 * those rather than treating it as an error.
 *
 * States are queried in parallel, not one after another — a real account
 * easily spans 25-30+ distinct states, and awaiting each one's (up to two)
 * requests in sequence meant the whole call could take well over a minute
 * before ever resolving. Every state runs independently now, so total time
 * is roughly the slowest single state's two requests, not the sum of all
 * of them — this was the actual reason boundaries never appeared to finish
 * loading in practice, not the effect-dependency issue fixed earlier
 * (real, but not sufficient on its own with a fetch this slow). */
export async function fetchPlaceBoundaries(cities: { city: string; state: string }[]): Promise<Map<string, PlaceGeometry>> {
  const result = new Map<string, PlaceGeometry>();
  const byState = new Map<string, { city: string; state: string }[]>();
  for (const c of cities) {
    const k = key(c.city, c.state);
    if (cache.has(k)) {
      const hit = cache.get(k);
      if (hit) result.set(k, hit);
      continue;
    }
    const fips = STATE_FIPS[c.state.trim().toUpperCase()];
    if (!fips) continue; // unrecognized state code — nothing to query
    if (!byState.has(fips)) byState.set(fips, []);
    byState.get(fips)!.push(c);
  }

  await Promise.all(
    Array.from(byState.entries()).map(async ([fips, group]) => {
      const found = await resolveState(fips, group);
      for (const c of group) {
        const geom = found.get(c.city.trim().toLowerCase()) ?? null;
        const k = key(c.city, c.state);
        cache.set(k, geom);
        if (geom) result.set(k, geom);
      }
    }),
  );

  return result;
}

export { key as placeGeoKey };
