import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Tier, ZipStat } from './CityPerformanceMap';

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

const pct = (n: number) => `${Math.round(n * 100)}%`;

interface ZipMarker extends ZipStat {
  lat: number;
  lng: number;
}

/**
 * A real, tile-based street map (OpenStreetMap, same free/keyless tiles
 * PacketMap already uses elsewhere in this app) for the city drill-down —
 * unlike the national view, a zip-code comparison genuinely needs roads and
 * neighborhood context to mean anything, and cropping the stylized SVG map
 * tight enough to separate a city's zip codes just collapsed them all into
 * a cluster of concentric rings around one point instead. Leaflet's own
 * fitBounds handles the zoom level, so zips always end up visibly spread
 * out regardless of how tightly or loosely packed they really are.
 */
export function CityZipMap({ zips, cityLabel }: { zips: ZipMarker[]; cityLabel: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || zips.length === 0) return;

    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const maxTotal = Math.max(...zips.map((z) => z.total), 1);
    const radiusFor = (total: number) => 8 + 22 * Math.sqrt(total / maxTotal);

    const bounds = L.latLngBounds([]);
    for (const z of zips) {
      const marker = L.circleMarker([z.lat, z.lng], {
        radius: radiusFor(z.total),
        color: TIER_COLOR[z.tier],
        weight: 2,
        fillColor: TIER_COLOR[z.tier],
        fillOpacity: 0.45,
      }).addTo(map);

      marker.bindPopup(
        `<div style="font:500 13px system-ui;min-width:170px">
           <div style="font-weight:600;margin-bottom:3px">${z.zip5}</div>
           <div style="color:${TIER_COLOR[z.tier]};font-weight:600;font-size:12px;margin-bottom:4px">
             ${TIER_LABEL[z.tier]}
           </div>
           <div style="color:#64748b;font-size:12px;line-height:1.5">
             ${z.total} contacted<br/>
             ${z.qualified} qualified (${pct(z.qualifyRate)})<br/>
             ${z.replied} replied (${pct(z.replyRate)})
           </div>
         </div>`,
      );
      bounds.extend([z.lat, z.lng]);
    }

    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Keyed on the markers' own values (not the array reference) so a
    // re-render with an equivalent list doesn't tear down and rebuild the
    // Leaflet map — same reasoning as PacketMap's own effect dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(zips.map((z) => [z.zip5, z.lat, z.lng, z.tier, z.total]))]);

  if (zips.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center rounded-xl border border-border-2 text-[13px] text-text-3">
        Not enough zip-level data for {cityLabel} yet.
      </div>
    );
  }

  return <div ref={containerRef} className="isolate h-96 w-full rounded-xl border border-border-2" />;
}
