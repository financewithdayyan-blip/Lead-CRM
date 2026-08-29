import type { StyleSpecification } from 'maplibre-gl';

/**
 * A hand-authored MapLibre style over OpenFreeMap's free, keyless vector
 * tiles (openfreemap.org — standard OpenMapTiles schema, no signup, no API
 * key, self-hostable, verified reachable from the production origin, tile
 * endpoint itself confirmed to send `access-control-allow-origin: *`). Used
 * instead of CARTO's dark tiles (now key-gated in production despite the
 * documented free anonymous tier — confirmed by requesting a live tile,
 * which comes back stamped "API KEY REQUIRED") or plain OSM raster tiles run
 * through a CSS invert filter (roads/vegetation/buildings baked into raster
 * pixels in their default OSM colors, so a filter can only recolor them, not
 * restyle them into something that matches the app).
 *
 * A first version drew only water, boundaries, and labels — too sparse: a
 * tight zoom on a small/inland city could have none of those three in frame
 * and render as an empty rectangle. This version keeps real geographic
 * texture (vegetation, buildings, roads) but recolors every layer into the
 * app's own dark-navy palette (STATE_FILL/STATE_STROKE in
 * CityPerformanceMap.tsx) instead of OSM's default bright greens/yellows/
 * pinks, so it still reads as one consistent map with the national
 * choropleth rather than a generic basemap dropped in underneath it.
 *
 * Layer/field names below are copied from OpenFreeMap's own published
 * "positron" style (fetched and inspected directly), not guessed — the
 * OpenMapTiles schema names its layers and properties (source-layer
 * "boundary" + admin_level, "transportation" + class, "place" + class) the
 * same way across any vector source built on it. Building footprints only
 * actually appear past the schema's own minzoom:12 — i.e. at the zip-level
 * map's closer zoom, not the state-level city map, which never zooms in
 * that far.
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
      id: 'landcover-wood',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'wood'],
      minzoom: 10,
      paint: { 'fill-color': '#16261c', 'fill-opacity': 0.8 },
    },
    {
      id: 'park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      paint: { 'fill-color': '#1c3a26', 'fill-opacity': 0.7 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': '#0c1f33' },
    },
    {
      id: 'building',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 12,
      paint: { 'fill-color': '#28405c', 'fill-opacity': 0.85, 'fill-outline-color': '#345172' },
    },
    {
      id: 'road-minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['match', ['get', 'class'], ['minor', 'service', 'track'], true, false],
      minzoom: 8,
      paint: { 'line-color': '#26405c', 'line-width': 0.7 },
    },
    {
      id: 'road-major',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
      minzoom: 5,
      paint: {
        'line-color': '#3c5f88',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 14, 2],
      },
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
