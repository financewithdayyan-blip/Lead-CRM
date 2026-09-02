import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Tier, ZipStat } from './CityPerformanceMap';
import { fetchZctaBoundaries } from '@/lib/zctaBoundaries';
import { MAP_STYLE } from '@/lib/mapStyle';
import { geocodeAddress } from '@/lib/geocode';
import { useLeadGeocodes, useUpsertLeadGeocode } from '@/hooks/useLeadGeocodes';

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
const STATE_FILL = '#102338'; // matches CityPerformanceMap's national-view background, shown while tiles load

// Every zip shape (circle or boundary polygon) fades in via this transition
// rather than popping in instantly — same treatment for the property pins
// layered on top and for the circle-to-boundary swap below. Scoped to this
// component's own wrapper class so it never touches Leaflet paths in other
// maps (PacketMap, StateCityMap) that don't opt into it.
const FADE_MS = 280;

function popupHtml(z: ZipStat) {
  return `<div style="font:500 13px system-ui;min-width:170px">
     <div style="font-weight:600;margin-bottom:3px">${z.zip5}</div>
     <div style="color:${TIER_COLOR[z.tier]};font-weight:600;font-size:12px;margin-bottom:4px">
       ${TIER_LABEL[z.tier]}
     </div>
     <div style="color:#64748b;font-size:12px;line-height:1.5">
       ${z.total} contacted<br/>
       ${z.contracts} contracts (${pct(z.contractRate)})<br/>
       ${z.qualified} qualified (${pct(z.qualifyRate)})<br/>
       ${z.replied} replied (${pct(z.replyRate)})
     </div>
   </div>`;
}
const pct = (n: number) => `${Math.round(n * 100)}%`;

interface ZipMarker extends ZipStat {
  lat: number;
  lng: number;
}

/**
 * The city drill-down. Went through a few basemap iterations: TIGERweb's
 * own Primary+Secondary road layers only (too sparse once you're actually
 * looking at one city), then full OSM raster tiles dark-filtered via CSS
 * (roads/vegetation/buildings baked into the pixels, too dense/cluttered
 * and impossible to selectively strip since it's raster, not layered data).
 * Settled on a minimal custom MapLibre style (src/lib/mapStyle.ts) over
 * free keyless OpenFreeMap vector tiles — just water, boundaries, and place
 * labels, colored to match the national map — same basemap StateCityMap one
 * level up uses, so all three drill-down levels read as one consistent map.
 *
 * Each zip starts as a plain circle at its centroid (instant — the geocode
 * is already in hand), then upgrades to its real boundary shape the moment
 * TIGERweb's polygon resolves. A zip TIGERweb has nothing for just keeps
 * its circle.
 */
export function CityZipMap({ zips, cityLabel }: { zips: ZipMarker[]; cityLabel: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const { data: leadGeocodes = new Map() } = useLeadGeocodes();
  const upsertLeadGeocode = useUpsertLeadGeocode();

  useEffect(() => {
    if (!containerRef.current || zips.length === 0) return;

    // Cover the map with the loading overlay again on every rebuild (not
    // just first mount) — switching cities re-runs this effect on the same
    // component instance, and the base tiles/shapes need to repopulate
    // behind the overlay the same way they did the first time.
    overlayRef.current?.classList.remove('opacity-0', 'pointer-events-none');
    overlayRef.current?.classList.add('opacity-100');

    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    mapRef.current = map;
    let cancelled = false;

    // Property pins get their own pane, stacked above both the zip-shading
    // overlayPane (circles + boundary polygons, z-index 400) and the
    // tilePane, so they're always clickable regardless of add order — the
    // boundary polygons that swap in later would otherwise cover them, since
    // Leaflet stacks same-pane layers by insertion order.
    map.createPane('propertyPins');
    const pinPane = map.getPane('propertyPins');
    if (pinPane) pinPane.style.zIndex = '650';

    maplibreGL({ style: MAP_STYLE }).addTo(map);
    // Must remove opacity-100, not just add opacity-0 — Tailwind utility
    // classes for the same property don't override by DOM add-order, only
    // by their fixed position in the compiled stylesheet, so leaving both
    // classes on the element at once left this stuck at opacity-100 forever
    // regardless of when opacity-0 was added.
    const hideOverlay = () => {
      overlayRef.current?.classList.remove('opacity-100');
      overlayRef.current?.classList.add('opacity-0', 'pointer-events-none');
    };

    const maxTotal = Math.max(...zips.map((z) => z.total), 1);
    const radiusFor = (total: number) => 8 + 22 * Math.sqrt(total / maxTotal);

    // Adds a path layer at zero opacity, then bumps it to its real style one
    // frame later — the jump from nothing to a flat-colored shape reads as a
    // pop; fading the opacity change (via the CSS transition below) makes it
    // read as the shape resolving in, not appearing.
    function fadeIn<T extends { setStyle: (style: L.PathOptions) => unknown; addTo: (map: L.Map) => unknown }>(
      layer: T,
      targetStyle: L.PathOptions,
    ) {
      layer.setStyle({ ...targetStyle, opacity: 0, fillOpacity: 0 });
      layer.addTo(map);
      requestAnimationFrame(() => layer.setStyle(targetStyle));
      return layer;
    }

    const markersByZip = new Map<string, L.CircleMarker>();
    const bounds = L.latLngBounds([]);
    for (const z of zips) {
      const marker = fadeIn(
        L.circleMarker([z.lat, z.lng], { radius: radiusFor(z.total) }),
        { color: TIER_COLOR[z.tier], weight: 2, fillColor: TIER_COLOR[z.tier], fillOpacity: 0.45 },
      );
      marker.bindPopup(popupHtml(z));
      markersByZip.set(z.zip5, marker);
      bounds.extend([z.lat, z.lng]);
    }

    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });

    // Deliberately not gated on the MapLibre base layer's own 'load' event
    // (its vector tiles come from a free public host — slow or congested
    // under load, and briefly left the overlay stuck covering a map that
    // was otherwise ready). The zip shapes above are already scheduled and
    // fitBounds has already placed them; one frame later they're actually
    // painted (still zero-opacity, about to fade in), so revealing the
    // overlay here means the overlay's fade-out and the shapes' fade-in
    // happen together — the base tiles keep loading underneath regardless.
    requestAnimationFrame(hideOverlay);

    // Small fixed-size dots for each shown zip's under-contract,
    // in-negotiation, partial-qualified, and qualified properties — a much
    // smaller, independent layer on top of the zip shading above, so it
    // never gets mistaken for the zip's own performance tier. Green for
    // under contract (contract/in title/closed), yellow for negotiation.
    // Partial-qualified/qualified use their exact STAGE_CONFIG purple
    // shades (src/types/domain.ts) so they read as the same stage color as
    // the Kanban board — same dark outline as the other pin kinds either
    // way. Whatever's already cached (leadGeocodes) renders immediately;
    // anything still missing geocodes lazily in the background (same
    // 1.1s-spaced pattern CityPerformanceMap's own city loop uses) and is
    // written back via useUpsertLeadGeocode so every future view already
    // has it.
    const PIN_COLOR = {
      contract: '#22c55e',
      negotiation: '#f5d90a',
      partial_qualified: '#a78bfa',
      qualified: '#c084fc',
    } as const;
    const PIN_LABEL = {
      contract: 'Under contract',
      negotiation: 'In negotiation',
      partial_qualified: 'Partial Qualified',
      qualified: 'Qualified',
    } as const;
    function addPropertyMarker(prop: { address: string }, kind: keyof typeof PIN_COLOR, lat: number, lng: number) {
      const marker = fadeIn(L.circleMarker([lat, lng], { radius: 5, pane: 'propertyPins' }), {
        color: '#0b1826',
        weight: 1.5,
        fillColor: PIN_COLOR[kind],
        fillOpacity: 1,
      });
      marker.bindPopup(
        `<div style="font:500 13px system-ui;min-width:150px">
           <div style="font-weight:600;margin-bottom:2px">${prop.address}</div>
           <div style="color:#64748b;font-size:12px">${PIN_LABEL[kind]}</div>
         </div>`,
      );
    }
    const properties = [
      ...zips.flatMap((z) => z.contractProperties.map((p) => ({ ...p, kind: 'contract' as const }))),
      ...zips.flatMap((z) => z.negotiationProperties.map((p) => ({ ...p, kind: 'negotiation' as const }))),
      ...zips.flatMap((z) => z.partialQualifiedProperties.map((p) => ({ ...p, kind: 'partial_qualified' as const }))),
      ...zips.flatMap((z) => z.qualifiedProperties.map((p) => ({ ...p, kind: 'qualified' as const }))),
    ];
    const missingGeo: typeof properties = [];
    for (const prop of properties) {
      const geo = leadGeocodes.get(prop.id);
      if (geo) addPropertyMarker(prop, prop.kind, geo.lat, geo.lng);
      else missingGeo.push(prop);
    }
    if (missingGeo.length > 0) {
      (async () => {
        for (const prop of missingGeo) {
          if (cancelled) return;
          const point = await geocodeAddress(prop.address, `${prop.city}, ${prop.state}`).catch(() => null);
          if (point && !cancelled) {
            addPropertyMarker(prop, prop.kind, point.lat, point.lng);
            upsertLeadGeocode.mutate({ leadId: prop.id, lat: point.lat, lng: point.lng });
          }
          await new Promise((r) => setTimeout(r, 1100));
        }
      })();
    }

    // Real boundary shapes arrive after the map already has something
    // useful on screen — each one swaps out that zip's circle for its
    // actual shaded shape as soon as it resolves, not all-or-nothing. The
    // old circle fades out while the polygon fades in underneath it (both
    // in the same overlayPane, so the swap reads as a crossfade rather than
    // an instant substitution) before the circle is actually removed.
    fetchZctaBoundaries(zips.map((z) => z.zip5)).then((boundaries) => {
      if (cancelled) return;
      for (const z of zips) {
        const geometry = boundaries.get(z.zip5);
        if (!geometry) continue;
        const oldMarker = markersByZip.get(z.zip5);
        fadeIn(L.geoJSON(geometry as GeoJSON.GeoJsonObject), {
          color: TIER_COLOR[z.tier],
          weight: 2,
          fillColor: TIER_COLOR[z.tier],
          fillOpacity: 0.45,
        }).bindPopup(popupHtml(z));
        if (oldMarker) {
          oldMarker.setStyle({ opacity: 0, fillOpacity: 0 });
          setTimeout(() => {
            if (!cancelled) map.removeLayer(oldMarker);
          }, FADE_MS);
        }
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
    <div className="city-zip-map relative isolate h-96 w-full overflow-hidden rounded-xl border border-border-2">
      <style>{`.city-zip-map .leaflet-interactive { transition: opacity ${FADE_MS}ms ease, fill-opacity ${FADE_MS}ms ease; }`}</style>
      <div ref={containerRef} className="h-full w-full" style={{ background: STATE_FILL }} />
      <div
        ref={overlayRef}
        className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center gap-2 text-[13px] text-text-3 opacity-100 transition-opacity duration-300"
        style={{ background: STATE_FILL }}
      >
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-text-3/30 border-t-text-3" />
        Loading map…
      </div>
    </div>
  );
}
