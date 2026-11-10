import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface PickerPin {
  id: string;
  kind: 'sold' | 'listing';
  address: string | null;
  price: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  lat: number;
  lng: number;
}

const COLOR = { listing: '#10b981', sold: '#f59e0b' } as const;
const SUBJECT_COLOR = '#6E7BFF';

const money = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function pinIcon(color: string, selected: boolean) {
  return L.divIcon({
    className: '',
    html: `<span style="
      display:block;width:${selected ? 20 : 16}px;height:${selected ? 20 : 16}px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);background:${color};
      border:${selected ? 3 : 2}px solid #fff;box-shadow:0 1px ${selected ? 6 : 4}px rgba(0,0,0,.5);"></span>`,
    iconSize: [selected ? 20 : 16, selected ? 20 : 16],
    iconAnchor: [selected ? 10 : 8, selected ? 20 : 16],
    popupAnchor: [0, -16],
  });
}

function subjectIcon() {
  return L.divIcon({
    className: '',
    html: `<span style="
      display:block;width:14px;height:14px;border-radius:50%;background:${SUBJECT_COLOR};
      border:2px solid #fff;box-shadow:0 0 0 3px ${SUBJECT_COLOR}55;"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

/** AI Comping's own map, forked from PacketMap — unlike that one (which
 *  deliberately never plots the subject, since packets are public-facing),
 *  this is admin-only internal tooling, so the subject property IS shown,
 *  and every comp pin is clickable to toggle it in/out of the current
 *  selection instead of just being informational. */
export function CompPickerMap({
  pins,
  subject,
  selectedIds,
  onToggle,
}: {
  pins: PickerPin[];
  subject: { lat: number; lng: number } | null;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  useEffect(() => {
    if (!containerRef.current || (!pins.length && !subject)) return;

    const map = L.map(containerRef.current, { scrollWheelZoom: true, zoomControl: true });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const bounds = L.latLngBounds([]);

    if (subject) {
      L.marker([subject.lat, subject.lng], { icon: subjectIcon(), zIndexOffset: 1000 })
        .addTo(map)
        .bindPopup('<div style="font:600 13px system-ui">Subject property</div>');
      bounds.extend([subject.lat, subject.lng]);
    }

    for (const p of pins) {
      const selected = selectedIds.has(p.id);
      const marker = L.marker([p.lat, p.lng], { icon: pinIcon(COLOR[p.kind], selected) }).addTo(map);

      const spec = [
        p.beds != null ? `${p.beds} bd` : null,
        p.baths != null ? `${p.baths} ba` : null,
        p.sqft != null ? `${p.sqft.toLocaleString()} sq ft` : null,
      ]
        .filter(Boolean)
        .join(' · ');

      marker.bindPopup(
        `<div style="font:500 13px system-ui;min-width:150px">
           <div style="font-weight:600;margin-bottom:2px">${p.address ?? 'Property'}</div>
           <div style="color:${COLOR[p.kind]};font-weight:600;font-size:12px">
             ${p.kind === 'listing' ? 'Listed' : 'Sold'} · ${money(p.price)}
           </div>
           ${spec ? `<div style="color:#64748b;font-size:12px">${spec}</div>` : ''}
           <button id="toggle-${p.id}" style="margin-top:6px;width:100%;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ${selected ? '#ef4444' : COLOR[p.kind]};background:${selected ? '#ef444422' : `${COLOR[p.kind]}22`};color:${selected ? '#ef4444' : COLOR[p.kind]}">
             ${selected ? 'Remove from selection' : 'Add to selection'}
           </button>
         </div>`,
      );
      marker.on('popupopen', () => {
        document.getElementById(`toggle-${p.id}`)?.addEventListener('click', () => onToggleRef.current(p.id));
      });
      marker.on('click', () => onToggleRef.current(p.id));
      bounds.extend([p.lat, p.lng]);
    }

    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Depends on primitive-derived keys rather than the array/object/Set
    // references themselves — same reasoning PacketMap documents on its
    // own effect deps, to avoid tearing down and rebuilding the whole map
    // on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(pins.map((p) => [p.id, p.lat, p.lng])),
    JSON.stringify([...selectedIds]),
    subject?.lat,
    subject?.lng,
  ]);

  if (!pins.length && !subject) return null;

  return (
    <div>
      <div ref={containerRef} className="isolate h-[420px] w-full rounded-xl border border-border" />
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] text-text-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: SUBJECT_COLOR }} />
          Subject property
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR.listing }} />
          Listing
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR.sold }} />
          Sold
        </span>
        <span className="text-text-3">Click a pin to add/remove it from your selection</span>
      </div>
    </div>
  );
}
