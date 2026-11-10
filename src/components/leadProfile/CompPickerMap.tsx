import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type PickerKind = 'sold' | 'listing' | 'rental';

export interface PickerPin {
  id: string;
  kind: PickerKind;
  address: string | null;
  price: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  lat: number;
  lng: number;
}

// Sold = yellow, Listed (on market) = red, Rental = purple — per explicit
// color spec, not the earlier green/amber scheme.
export const KIND_COLOR: Record<PickerKind, string> = { sold: '#eab308', listing: '#ef4444', rental: '#a855f7' };
const SUBJECT_COLOR = '#6E7BFF';

function shortPrice(n: number | null): string {
  if (n == null) return '—';
  if (n < 10_000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${Math.round(n / 1000)}K`;
}

/** A rounded price bubble rather than a plain pin — the price is the thing
 *  worth seeing at a glance across a map full of comps, not just a dot's
 *  color. `active` (its detail card is currently open) gets a bright ring;
 *  `added` (already picked) gets a small check badge. */
function priceIcon(color: string, price: number | null, active: boolean, added: boolean) {
  const label = shortPrice(price);
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;
        padding:3px 8px;border-radius:999px;background:${color};color:#fff;font:700 11px system-ui;
        border:2px solid ${active ? '#fff' : 'rgba(255,255,255,.85)'};
        box-shadow:${active ? `0 0 0 3px ${color}99, 0 2px 6px rgba(0,0,0,.5)` : '0 1px 4px rgba(0,0,0,.4)'};
        transform:${active ? 'scale(1.15)' : 'scale(1)'};">
        ${label}
        ${added ? `<span style="position:absolute;top:-6px;right:-6px;width:14px;height:14px;border-radius:50%;background:#10b981;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:9px;line-height:1;color:#fff;">✓</span>` : ''}
      </div>`,
    iconSize: [54, 24],
    iconAnchor: [27, 24],
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
 *  this is admin-only internal tooling, so the subject property IS shown.
 *  Clicking a pin opens that comp's detail card (CompPickerModal owns the
 *  actual add/remove action) rather than toggling selection directly here. */
export function CompPickerMap({
  pins,
  subject,
  selectedIds,
  activeId,
  onSelect,
}: {
  pins: PickerPin[];
  subject: { lat: number; lng: number } | null;
  selectedIds: Set<string>;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

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
        .bindTooltip('Subject property', { direction: 'top' });
      bounds.extend([subject.lat, subject.lng]);
    }

    for (const p of pins) {
      const marker = L.marker([p.lat, p.lng], {
        icon: priceIcon(KIND_COLOR[p.kind], p.price, p.id === activeId, selectedIds.has(p.id)),
        zIndexOffset: p.id === activeId ? 900 : 0,
      }).addTo(map);
      marker.on('click', () => onSelectRef.current(p.id));
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
    JSON.stringify(pins.map((p) => [p.id, p.lat, p.lng, p.price, p.kind])),
    JSON.stringify([...selectedIds]),
    activeId,
    subject?.lat,
    subject?.lng,
  ]);

  if (!pins.length && !subject) return null;

  return (
    <div>
      <div ref={containerRef} className="isolate h-[560px] w-full rounded-xl border border-border" />
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] text-text-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: SUBJECT_COLOR }} />
          Subject property
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOR.listing }} />
          Listed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOR.sold }} />
          Sold
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOR.rental }} />
          Rental
        </span>
        <span className="text-text-3">Click a pin for details</span>
      </div>
    </div>
  );
}
