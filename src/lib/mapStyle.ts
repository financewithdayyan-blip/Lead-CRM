import type { StyleSpecification } from 'maplibre-gl';

/**
 * A minimal, hand-authored MapLibre style over OpenFreeMap's free, keyless
 * vector tiles (openfreemap.org — standard OpenMapTiles schema, no signup,
 * no API key, self-hostable, verified reachable from the production origin).
 * Used instead of CARTO's dark tiles (now key-gated in production despite
 * the documented free anonymous tier — confirmed by requesting a live tile,
 * which comes back stamped "API KEY REQUIRED") or plain OSM raster tiles run
 * through a CSS invert filter: roads, vegetation, and buildings are baked
 * into raster pixels, so a filter can only recolor them, never remove them.
 *
 * Only three layers are drawn — water, state/county boundary lines, and
 * place-name labels — no roads, no landcover/landuse/park vegetation fill,
 * no buildings. Colors match the national choropleth map's own palette
 * (STATE_FILL/STATE_STROKE in CityPerformanceMap.tsx) so every drill-down
 * level reads as one consistent map instead of three different basemaps.
 *
 * Layer/field names below are copied from OpenFreeMap's own published
 * "positron" style (fetched and inspected directly), not guessed — the
 * OpenMapTiles schema names its layers and properties (source-layer
 * "boundary" + admin_level, source-layer "place" + class) the same way
 * across any vector source built on it.
 */
export const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    openmaptiles: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
    },
  },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#102338' },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': '#0c1f33' },
    },
    {
      id: 'boundary-admin',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['all', ['>=', ['get', 'admin_level'], 2], ['<=', ['get', 'admin_level'], 6], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': '#1f3a57', 'line-width': 1 },
    },
    {
      id: 'place-label',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['match', ['get', 'class'], ['city', 'town', 'village'], true, false],
      layout: {
        'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 12, 15],
      },
      paint: {
        'text-color': '#e2e8f0',
        'text-halo-color': '#0b1826',
        'text-halo-width': 1.2,
      },
    },
  ],
};
