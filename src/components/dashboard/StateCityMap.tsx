import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Tier, CityStat } from './CityPerformanceMap';
import { fetchPlaceBoundaries, placeGeoKey } from '@/lib/placeBoundaries';

const TIER_COLOR: Record<Tier, string> = {
  green: '#22c55e',
  yellow: '#eab308',
  red: '#ef4444',
};
const TIER_LABEL: Record<Tier, string> = {
  green: 'Performing market',
  yellow: 'Fair market',
  red: 'Poor market',
};
const STATE_FILL = '#102338';

const pct = (n: number) => `${Math.round(n * 100)}%`;

interface CityMarker extends CityStat {
  lat: number;
  lng: number;
}

function tooltipHtml(c: CityStat) {
  return `<div style="font:500 13px system-ui;min-width:170px">
     <div style="font-weight:600;margin-bottom:3px">${c.city}, ${c.state}</div>
     <div style="color:${TIER_COLOR[c.tier]};font-weight:600;font-size:12px;margin-bottom:4px">
       ${TIER_LABEL[c.tier]}
     </div>
     <div style="color:#64748b;font-size:12px;line-height:1.5">
       ${c.total} contacted<br/>
       ${c.contracts} contracts (${pct(c.contractRate)})<br/>
       ${c.qualified} qualified (${pct(c.qualifyRate)})<br/>
       ${c.replied} replied (${pct(c.replyRate)})
     </div>
     <div style="color:#475569;font-size:11px;margin-top:4px">Click for zip codes</div>
   </div>`;
}

/**
 * The state-level city drill-down — same real tile map + circle-that-
 * upgrades-to-real-boundary pattern as CityZipMap, not the SVG/Albers-USA
 * abstraction the national map uses. That SVG approach kept rendering cities
 * as plain circles even for large cities with confirmed-good TIGERweb data
 * (Buffalo, Rochester) despite three rounds of fixes elsewhere in the
 * pipeline (effect timing, fetch parallelism, fetch scope) — the data was
 * never the problem. Reusing CityZipMap's already-proven Leaflet approach
 * sidesteps whatever was wrong with the SVG path rendering entirely instead
 * of chasing it further.
 *
 * Each city starts as a plain circle at its geocoded point (instant), then
 * upgrades to its real TIGERweb municipal boundary the moment that resolves.
 * A city TIGERweb has nothing for just keeps its circle. Clicking a marker
 * (circle or resolved boundary) drills into that city's own zip-code map.
 */
export function StateCityMap({
  cities,
  stateLabel,
  onSelectCity,
}: {
  cities: CityMarker[];
  stateLabel: string;
  onSelectCity: (city: CityStat) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const onSelectCityRef = useRef(onSelectCity);
  onSelectCityRef.current = onSelectCity;

  useEffect(() => {
    if (!containerRef.current || cities.length === 0) return;

    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    mapRef.current = map;
    let cancelled = false;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      className: 'map-tiles-dark',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const maxTotal = Math.max(...cities.map((c) => c.total), 1);
    const radiusFor = (total: number) => 10 + 26 * Math.sqrt(total / maxTotal);

    const markersByCity = new Map<string, L.CircleMarker>();
    const bounds = L.latLngBounds([]);
    for (const c of cities) {
      const marker = L.circleMarker([c.lat, c.lng], {
        radius: radiusFor(c.total),
        color: TIER_COLOR[c.tier],
        weight: 2,
        fillColor: TIER_COLOR[c.tier],
        fillOpacity: 0.45,
      }).addTo(map);
      marker.bindTooltip(tooltipHtml(c), { sticky: true });
      marker.on('click', () => onSelectCityRef.current(c));
      markersByCity.set(placeGeoKey(c.city, c.state), marker);
      bounds.extend([c.lat, c.lng]);
    }

    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 10 });

    // Real boundary shapes arrive after the map already has something
    // useful on screen — each one swaps out that city's circle for its
    // actual shaded shape as soon as it resolves, not all-or-nothing.
    fetchPlaceBoundaries(cities.map((c) => ({ city: c.city, state: c.state }))).then((boundaries) => {
      if (cancelled) return;
      for (const c of cities) {
        const geoKey = placeGeoKey(c.city, c.state);
        const geometry = boundaries.get(geoKey);
        if (!geometry) continue;
        const marker = markersByCity.get(geoKey);
        if (marker) map.removeLayer(marker);
        L.geoJSON(geometry as GeoJSON.GeoJsonObject, {
          style: { color: TIER_COLOR[c.tier], weight: 2, fillColor: TIER_COLOR[c.tier], fillOpacity: 0.45 },
        })
          .bindTooltip(tooltipHtml(c), { sticky: true })
          .on('click', () => onSelectCityRef.current(c))
          .addTo(map);
      }
    });

    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
    };
    // Keyed on the markers' own values (not the array reference) so a
    // re-render with an equivalent list doesn't tear down and rebuild the
    // Leaflet map — same reasoning as CityZipMap's own effect dependency.
    // onSelectCity itself is read through a ref so a new function identity
    // on every DashboardPage re-render never triggers a rebuild either.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cities.map((c) => [c.cityKey, c.stateKey, c.lat, c.lng, c.tier, c.total])), stateLabel]);

  if (cities.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center rounded-xl border border-border-2 text-[13px] text-text-3">
        Not enough city-level data for {stateLabel} yet.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="isolate h-96 w-full rounded-xl border border-border-2"
      style={{ background: STATE_FILL }}
    />
  );
}
