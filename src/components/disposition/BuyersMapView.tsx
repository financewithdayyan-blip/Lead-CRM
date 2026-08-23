import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { GeoMultiSelect } from '@/components/disposition/GeoMultiSelect';
import { cityCoord, cityStateOptions, milesBetween, resolveCityStateOption, stateCentroid } from '@/data/usGeoCoords';
import { formatCurrency, formatPhone } from '@/lib/utils';
import { BUYER_PROPERTY_TYPE_LABELS, DEAL_TYPE_CONFIG, type CashBuyer } from '@/types/domain';

const NEARBY_RADIUS_MILES = 40;

interface Point {
  lat: number;
  lng: number;
}

interface BuyerMarker extends Point {
  key: string;
  label: string;
  kind: 'city' | 'state';
  buyers: CashBuyer[];
}

/** One marker per resolved point, buyers who land on the same city grouped
 *  into one pin instead of stacking duplicates. A buyer contributes a pin
 *  for every city AND every state they set — a buyer who named both
 *  specific cities and a broader state ("Atlanta, GA... and anywhere in
 *  Massachusetts") is honestly two different kinds of buy-box claim, so
 *  both show rather than picking one. Cities that don't resolve (real
 *  unincorporated places like Buckhead) are silently skipped — they still
 *  work fine for buy-box matching, they just can't be placed on a map. */
function buildMarkers(buyers: CashBuyer[]): BuyerMarker[] {
  const byKey = new Map<string, BuyerMarker>();

  function addPoint(point: Point, label: string, kind: BuyerMarker['kind'], buyer: CashBuyer) {
    const key = `${kind}:${point.lat.toFixed(2)},${point.lng.toFixed(2)}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.buyers.includes(buyer)) existing.buyers.push(buyer);
    } else {
      byKey.set(key, { key, lat: point.lat, lng: point.lng, label, kind, buyers: [buyer] });
    }
  }

  for (const buyer of buyers) {
    for (const city of buyer.marketCities) {
      const coord = cityCoord(city, buyer.marketStates);
      if (coord) addPoint(coord, city, 'city', buyer);
    }
    for (const state of buyer.marketStates) {
      const centroid = stateCentroid(state);
      if (centroid) addPoint(centroid, `${state} (statewide)`, 'state', buyer);
    }
  }

  return [...byKey.values()];
}

function buyerPoints(buyer: CashBuyer): Point[] {
  const points: Point[] = [];
  for (const city of buyer.marketCities) {
    const coord = cityCoord(city, buyer.marketStates);
    if (coord) points.push(coord);
  }
  for (const state of buyer.marketStates) {
    const centroid = stateCentroid(state);
    if (centroid) points.push(centroid);
  }
  return points;
}

function priceRangeLabel(buyer: CashBuyer): string {
  if (buyer.priceMin == null && buyer.priceMax == null) return 'Any price';
  if (buyer.priceMin != null && buyer.priceMax != null) return `${formatCurrency(buyer.priceMin)} – ${formatCurrency(buyer.priceMax)}`;
  if (buyer.priceMin != null) return `${formatCurrency(buyer.priceMin)}+`;
  return `Up to ${formatCurrency(buyer.priceMax)}`;
}

function pinIcon(kind: BuyerMarker['kind'], count: number) {
  const color = kind === 'city' ? '#2563eb' : '#7c3aed';
  const size = count > 1 ? 30 : 22;
  return L.divIcon({
    className: '',
    html: `<div style="
        display:flex;align-items:center;justify-content:center;
        width:${size}px;height:${size}px;border-radius:50%;
        background:${color};color:#fff;font:700 ${count > 1 ? 12 : 10}px system-ui;
        border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);">
        ${count > 1 ? count : ''}
      </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function buyerCardHtml(buyer: CashBuyer): string {
  const contact = [buyer.phone ? formatPhone(buyer.phone) : null, buyer.email].filter(Boolean).join(' · ');
  const types = buyer.propertyTypes.length > 0 ? buyer.propertyTypes.map((t) => BUYER_PROPERTY_TYPE_LABELS[t]).join(', ') : 'Any type';
  const deals = buyer.dealTypes.length > 0 ? buyer.dealTypes.map((t) => DEAL_TYPE_CONFIG[t].label).join(', ') : 'Any structure';
  return `<div style="font:500 12px system-ui;padding:4px 0;border-top:1px solid #e5e7eb;margin-top:4px">
      <div style="font-weight:700;font-size:13px;color:#111">${buyer.name}</div>
      ${contact ? `<div style="color:#64748b;font-size:11px">${contact}</div>` : ''}
      <div style="color:#334155;font-size:11px;margin-top:2px">${types}</div>
      <div style="color:#334155;font-size:11px">${priceRangeLabel(buyer)} · ${deals}</div>
    </div>`;
}

export function BuyersMapView({ buyers }: { buyers: CashBuyer[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [citySearch, setCitySearch] = useState<string[]>([]);

  const cityOptions = useMemo(() => cityStateOptions(), []);
  const markers = useMemo(() => buildMarkers(buyers), [buyers]);
  const unplacedCount = useMemo(() => buyers.filter((b) => buyerPoints(b).length === 0).length, [buyers]);

  const searchedPoint = useMemo(() => {
    const label = citySearch[0];
    return label ? resolveCityStateOption(label) : null;
  }, [citySearch]);

  const nearbyBuyers = useMemo(() => {
    if (!searchedPoint) return [];
    return buyers
      .map((b) => {
        const dists = buyerPoints(b).map((p) => milesBetween(p, searchedPoint));
        return { buyer: b, dist: dists.length > 0 ? Math.min(...dists) : Infinity };
      })
      .filter((x) => x.dist <= NEARBY_RADIUS_MILES)
      .sort((a, b) => a.dist - b.dist)
      .map((x) => x.buyer);
  }, [buyers, searchedPoint]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: true });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    map.setView([39.5, -98.35], 4); // continental US, before any marker/fit runs below

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Rebuilds markers whenever the buyer set changes, without tearing down
  // the map itself (which would reset the user's pan/zoom on every filter
  // tweak) — same reasoning as PacketMap's split between mount and pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const layer = L.layerGroup().addTo(map);
    for (const m of markers) {
      const marker = L.marker([m.lat, m.lng], { icon: pinIcon(m.kind, m.buyers.length) }).addTo(layer);
      const heading =
        m.kind === 'state'
          ? `<div style="font-weight:700;font-size:13px;color:#7c3aed">${m.label}</div>`
          : `<div style="font-weight:700;font-size:13px;color:#111">${m.label}</div>`;
      marker.bindPopup(
        `<div style="min-width:200px;max-height:260px;overflow-y:auto">
           ${heading}
           ${m.buyers.map(buyerCardHtml).join('')}
         </div>`,
      );
    }

    if (!searchedPoint && markers.length > 0) {
      const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 11 });
    }

    return () => {
      layer.remove();
    };
  }, [markers, searchedPoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !searchedPoint) return;
    map.setView([searchedPoint.lat, searchedPoint.lng], 10);
  }, [searchedPoint]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <GeoMultiSelect
            label="Search a city"
            placeholder="Type a city to jump the map there…"
            options={cityOptions}
            selected={citySearch}
            onChange={(next) => setCitySearch(next.length > 0 ? [next[next.length - 1]] : [])}
          />
        </div>
        {searchedPoint && (
          <p className="pb-2 text-[12px] text-text-3">
            {nearbyBuyers.length} buyer{nearbyBuyers.length === 1 ? '' : 's'} within {NEARBY_RADIUS_MILES} mi of {searchedPoint.name}, {searchedPoint.stateCode}
          </p>
        )}
      </div>

      <div ref={containerRef} className="isolate h-[480px] w-full rounded-xl border border-border-2" />

      <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] text-text-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#2563eb]" /> City-level buyer
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#7c3aed]" /> Statewide buyer (no specific city set)
        </span>
        {unplacedCount > 0 && (
          <span className="text-text-3">
            {unplacedCount} buyer{unplacedCount === 1 ? '' : 's'} with no mappable location aren't shown here
          </span>
        )}
      </div>

      {searchedPoint && nearbyBuyers.length > 0 && (
        <div className="mt-4 space-y-2">
          {nearbyBuyers.map((b) => (
            <div key={b.id} className="rounded-lg border border-border-2 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-text">{b.name}</span>
                <span className="text-[12px] text-text-3">{priceRangeLabel(b)}</span>
              </div>
              <div className="text-[12px] text-text-3">{[b.phone ? formatPhone(b.phone) : null, b.email].filter(Boolean).join(' · ')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
