/**
 * Road linework from the Census Bureau's TIGERweb Transportation service —
 * same free, keyless, public-domain infrastructure zctaBoundaries.ts already
 * relies on (unlike the community-run Overpass API, which timed out past
 * 25-30s on even a single mid-size city's major-roads query when tried
 * here). Two layers: Primary Roads (interstates/major highways) and
 * Secondary Roads at a scale matched to city zoom — deliberately not Local
 * Roads, which is the full dense street grid the "just zip boundaries and
 * roads, no buildings" request was explicitly trying to avoid.
 */

export interface RoadFeature {
  name: string | null;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
}

const TRANSPORTATION_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer';
const PRIMARY_ROADS_LAYER = 2;
const SECONDARY_ROADS_LAYER = 6; // "Secondary Roads 72_1k scale" — city-zoom detail, not the full local grid

async function fetchLayerRoads(layer: number, bbox: [number, number, number, number]): Promise<RoadFeature[]> {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const url = `${TRANSPORTATION_BASE}/${layer}/query?${new URLSearchParams({
    geometry: `${minLng},${minLat},${maxLng},${maxLat}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'NAME',
    f: 'geojson',
    outSR: '4326',
    geometryPrecision: '4',
    maxAllowableOffset: '0.0005',
  })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TIGERweb roads layer ${layer} returned ${res.status}`);
  const data = await res.json();
  return (data.features ?? [])
    .filter((f: any) => f.geometry)
    .map((f: any): RoadFeature => ({ name: f.properties?.NAME ?? null, geometry: f.geometry }));
}

/** Best-effort — a failed layer just contributes nothing rather than
 * failing the whole city view; the zip boundaries/markers still render. */
export async function fetchCityRoads(bbox: [number, number, number, number]): Promise<RoadFeature[]> {
  const results = await Promise.allSettled([
    fetchLayerRoads(PRIMARY_ROADS_LAYER, bbox),
    fetchLayerRoads(SECONDARY_ROADS_LAYER, bbox),
  ]);
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
