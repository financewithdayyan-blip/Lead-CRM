import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_STYLE } from '@/lib/mapStyle';
import { BUYER_TYPE_CONFIG } from '@/types/domain';
import type { BuyerCityPin as Pin } from '@/hooks/useDisposition';

/** Deterministic small offset so multiple buyers in the same city don't
 *  render as one stacked dot — same idea as a jittered scatter plot, seeded
 *  off the buyer id so a given buyer's dot doesn't jump around on re-render. */
function jitter(seed: string, index: number): [number, number] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const angle = ((hash % 360) + index * 47) * (Math.PI / 180);
  const radius = 0.006 + ((hash >> 8) % 5) * 0.0015;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** The Disposition page's state-level map: one small dot per buyer (colored
 *  by their primary investor-strategy tag), click-and-drag to lasso a
 *  freehand area and select every buyer inside it. No extra drawing library
 *  — just raw mouse events building a polyline and a plain ray-casting
 *  point-in-polygon test, since this only ever needs one simple closed
 *  shape, not arbitrary multi-shape editing. */
export function BuyerStateMap({
  pins,
  stateLabel,
  selectedIds,
  onSelectionChange,
  onCityClick,
}: {
  pins: Pin[];
  stateLabel: string;
  selectedIds: Set<string>;
  onSelectionChange: (buyerIds: string[]) => void;
  onCityClick: (city: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const lassoLayerRef = useRef<L.Polyline | null>(null);
  const drawingRef = useRef(false);
  const pointsRef = useRef<L.LatLng[]>([]);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const [lassoMode, setLassoMode] = useState(false);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onCityClickRef = useRef(onCityClick);
  onCityClickRef.current = onCityClick;
  const lassoModeRef = useRef(lassoMode);
  lassoModeRef.current = lassoMode;

  useEffect(() => {
    if (!containerRef.current || pins.length === 0) return;

    const map = L.map(containerRef.current, { scrollWheelZoom: true, dragging: true });
    mapRef.current = map;
    maplibreGL({ style: MAP_STYLE }).addTo(map);
    // Mounting inside a flex layout means the container's final width isn't
    // settled on the frame Leaflet first measures it — without this, the
    // map's internal panes compute against a stale size and their tiles/
    // controls paint past the rounded box into whatever sits next to it
    // (the buyer list card). A couple of staggered invalidateSize() calls
    // catch it once layout has actually settled.
    const resizeTimers = [50, 250].map((ms) => setTimeout(() => map.invalidateSize(), ms));

    const jittered = new Map<string, [number, number]>();
    const byCity = new Map<string, Pin[]>();
    for (const p of pins) {
      const key = `${p.city}|${p.state}`;
      byCity.set(key, [...(byCity.get(key) ?? []), p]);
    }
    for (const group of byCity.values()) {
      group.forEach((p, i) => {
        const [dLat, dLng] = jitter(p.buyerId, i);
        jittered.set(p.buyerId, [p.lat + dLat, p.lng + dLng]);
      });
    }

    const bounds = L.latLngBounds([]);
    const markers = new Map<string, L.CircleMarker>();
    for (const p of pins) {
      const [lat, lng] = jittered.get(p.buyerId) ?? [p.lat, p.lng];
      const color = p.buyerTypes[0] ? BUYER_TYPE_CONFIG[p.buyerTypes[0]].color : '#6E7BFF';
      const marker = L.circleMarker([lat, lng], { radius: 6, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.9 }).addTo(map);
      marker.bindTooltip(`${p.buyerName} · ${p.city}, ${p.state}`, { direction: 'top' });
      marker.on('click', () => {
        if (!lassoModeRef.current) onCityClickRef.current(p.city);
      });
      markers.set(p.buyerId, marker);
      bounds.extend([lat, lng]);
    }
    markersRef.current = markers;
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 12 });

    const container = map.getContainer();

    function handleDown(e: L.LeafletMouseEvent) {
      if (!lassoModeRef.current) return;
      drawingRef.current = true;
      pointsRef.current = [e.latlng];
      map.dragging.disable();
      if (lassoLayerRef.current) map.removeLayer(lassoLayerRef.current);
      lassoLayerRef.current = L.polyline([e.latlng], { color: '#6E7BFF', weight: 2, dashArray: '4 4' }).addTo(map);
    }
    function handleMove(e: L.LeafletMouseEvent) {
      if (!drawingRef.current) return;
      pointsRef.current.push(e.latlng);
      lassoLayerRef.current?.setLatLngs(pointsRef.current);
    }
    function handleUp() {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      map.dragging.enable();
      const polygon: [number, number][] = pointsRef.current.map((p) => [p.lng, p.lat]);
      if (polygon.length >= 3) {
        const inside = pins.filter((p) => {
          const [lat, lng] = jittered.get(p.buyerId) ?? [p.lat, p.lng];
          return pointInPolygon([lng, lat], polygon);
        });
        onSelectionChangeRef.current(inside.map((p) => p.buyerId));
      }
    }

    map.on('mousedown', handleDown);
    map.on('mousemove', handleMove);
    map.on('mouseup', handleUp);

    return () => {
      resizeTimers.forEach(clearTimeout);
      map.off('mousedown', handleDown);
      map.off('mousemove', handleMove);
      map.off('mouseup', handleUp);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(pins.map((p) => [p.buyerId, p.lat, p.lng]))]);

  // Highlight selected pins without rebuilding the whole map.
  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      const isSelected = selectedIds.has(id);
      marker.setStyle({ weight: isSelected ? 3 : 1.5, color: isSelected ? '#6E7BFF' : '#fff' });
    }
  }, [selectedIds]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) container.style.cursor = lassoMode ? 'crosshair' : '';
  }, [lassoMode]);

  if (pins.length === 0) {
    return <div className="flex h-[420px] items-center justify-center rounded-xl border border-border text-[13px] text-text-3">No geocoded buyer cities in {stateLabel} yet.</div>;
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setLassoMode((v) => !v)}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
            lassoMode ? 'border-primary bg-primary-dim text-primary-text' : 'border-border-2 bg-surface text-text-2 hover:bg-surface-3'
          }`}
        >
          ✏️ {lassoMode ? 'Click-drag to lasso buyers' : 'Draw a lasso to select buyers'}
        </button>
        {selectedIds.size > 0 && (
          <span className="text-[12.5px] text-text-3">{selectedIds.size} selected</span>
        )}
      </div>
      <div ref={containerRef} className="relative isolate h-[420px] w-full overflow-hidden rounded-xl border border-border" />
    </div>
  );
}
