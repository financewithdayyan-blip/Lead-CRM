import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Tier, ZipStat } from './CityPerformanceMap';
import { fetchZctaBoundaries } from '@/lib/zctaBoundaries';
import { fetchCityRoads } from '@/lib/tigerRoads';

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
const STATE_FILL = '#102338'; // matches CityPerformanceMap's national-view background
const ROAD_STROKE = '#2c4a6e';

const pct = (n: number) => `${Math.round(n * 100)}%`;

interface ZipMarker extends ZipStat {
  lat: number;
  lng: number;
}

function popupHtml(z: ZipStat) {
  return `<div style="font:500 13px system-ui;min-width:170px">
     <div style="font-weight:600;margin-bottom:3px">${z.zip5}</div>
     <div style="color:${TIER_COLOR[z.tier]};font-weight:600;font-size:12px;margin-bottom:4px">
       ${TIER_LABEL[z.tier]}
     </div>
     <div style="color:#64748b;font-size:12px;line-height:1.5">
       ${z.total} contacted<br/>
       ${z.qualified} qualified (${pct(z.qualifyRate)})<br/>
       ${z.replied} replied (${pct(z.replyRate)})
     </div>
   </div>`;
}

/**
 * The city drill-down, styled like the national map instead of a full
 * tile-based basemap — no buildings, no POI icons, no dense labels. Plain
 * dark navy background (same fill the national SVG map uses), TIGERweb
 * road linework for orientation (Primary + a city-scale Secondary Roads
 * layer — deliberately not Local Roads, the full street grid, which is
 * exactly the clutter "no buildings" was asking to avoid), and zip
 * boundaries shaded by performance tier. Every layer here comes from the
 * same free, keyless Census TIGERweb infrastructure zctaBoundaries.ts
 * already uses — tried the community Overpass API for roads first, but it
 * took 25-30s+ even for one mid-size city's major roads, too slow for a
 * click-to-drill-down interaction; TIGERweb's own Transportation service
 * answers the same kind of query in ~2-3s.
 *
 * Each zip starts as a plain circle at its centroid (instant — the geocode
 * is already in hand), then upgrades to its real boundary shape the moment
 * TIGERweb's polygon resolves. A zip TIGERweb has nothing for just keeps
 * its circle.
 */
export function CityZipMap({ zips, cityLabel }: { zips: ZipMarker[]; cityLabel: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || zips.length === 0) return;

    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    mapRef.current = map;
    let cancelled = false;

    const maxTotal = Math.max(...zips.map((z) => z.total), 1);
    const radiusFor = (total: number) => 8 + 22 * Math.sqrt(total / maxTotal);

    const markersByZip = new Map<string, L.CircleMarker>();
    const bounds = L.latLngBounds([]);
    for (const z of zips) {
      const marker = L.circleMarker([z.lat, z.lng], {
        radius: radiusFor(z.total),
        color: TIER_COLOR[z.tier],
        weight: 2,
        fillColor: TIER_COLOR[z.tier],
        fillOpacity: 0.45,
      }).addTo(map);
      marker.bindPopup(popupHtml(z));
      markersByZip.set(z.zip5, marker);
      bounds.extend([z.lat, z.lng]);
    }

    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });

    // Roads drawn first (added to the map before boundaries/markers stack
    // visually — Leaflet layers render in add-order), a comfortable margin
    // past the fitted bounds so a road doesn't dead-end right at the edge
    // of the visible area.
    const padded = bounds.pad(0.15);
    fetchCityRoads([padded.getWest(), padded.getSouth(), padded.getEast(), padded.getNorth()])
      .then((roads) => {
        if (cancelled) return;
        for (const road of roads) {
          L.geoJSON(road.geometry as GeoJSON.GeoJsonObject, {
            style: { color: ROAD_STROKE, weight: 1.25, opacity: 0.9 },
          }).addTo(map);
        }
      })
      .catch(() => {
        // Best-effort — the zip boundaries/markers below still tell the
        // real story even with no road context.
      });

    // Real boundary shapes arrive after the map already has something
    // useful on screen — each one swaps out that zip's circle for its
    // actual shaded shape as soon as it resolves, not all-or-nothing.
    fetchZctaBoundaries(zips.map((z) => z.zip5)).then((boundaries) => {
      if (cancelled) return;
      for (const z of zips) {
        const geometry = boundaries.get(z.zip5);
        if (!geometry) continue;
        const marker = markersByZip.get(z.zip5);
        if (marker) map.removeLayer(marker);
        L.geoJSON(geometry as GeoJSON.GeoJsonObject, {
          style: { color: TIER_COLOR[z.tier], weight: 2, fillColor: TIER_COLOR[z.tier], fillOpacity: 0.45 },
        })
          .bindPopup(popupHtml(z))
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

  return (
    <div
      ref={containerRef}
      className="isolate h-96 w-full rounded-xl border border-border-2"
      style={{ background: STATE_FILL }}
    />
  );
}
