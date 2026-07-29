import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapPin {
  id: string;
  kind: 'sold' | 'listing';
  address: string | null;
  price: number | null;
  sqft: number | null;
  date: string | null;
  lat: number;
  lng: number;
}

const COLOR = { listing: '#10b981', sold: '#f59e0b' } as const;

const money = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * Coloured pins built with divIcon rather than Leaflet's default marker images.
 * Those images are referenced by relative URL inside the package and break
 * under a bundler; inline markup avoids that entirely and lets the pin carry
 * the status colour directly.
 */
function pinIcon(kind: MapPin['kind']) {
  return L.divIcon({
    className: '',
    html: `<span style="
      display:block;width:16px;height:16px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);background:${COLOR[kind]};
      border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 16],
    popupAnchor: [0, -16],
  });
}

/**
 * OpenStreetMap tiles — free and keyless, and their licence requires the
 * attribution control that Leaflet renders by default. Do not remove it.
 *
 * The subject property is deliberately never plotted: packets disclose an area,
 * not an exact location, and a single pin would give the address away.
 */
export function PacketMap({ pins }: { pins: MapPin[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || !pins.length) return;

    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const bounds = L.latLngBounds([]);
    for (const p of pins) {
      const marker = L.marker([p.lat, p.lng], { icon: pinIcon(p.kind) }).addTo(map);
      marker.bindPopup(
        `<div style="font:500 13px system-ui;min-width:150px">
           <div style="font-weight:600;margin-bottom:2px">${p.address ?? 'Property'}</div>
           <div style="color:${COLOR[p.kind]};font-weight:600;font-size:12px">
             ${p.kind === 'listing' ? 'Currently listed' : 'Sold'} · ${money(p.price)}
           </div>
           ${p.sqft ? `<div style="color:#64748b;font-size:12px">${p.sqft.toLocaleString()} sq ft</div>` : ''}
         </div>`,
      );
      bounds.extend([p.lat, p.lng]);
    }

    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [pins]);

  if (!pins.length) return null;

  return (
    <div>
      <div ref={containerRef} className="h-72 w-full rounded-xl border border-border" />
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] text-text-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR.listing }} />
          Currently listed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR.sold }} />
          Recently sold
        </span>
        <span className="text-text-3">Subject property not shown</span>
      </div>
    </div>
  );
}
