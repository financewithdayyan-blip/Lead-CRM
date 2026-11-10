import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useRentcastComps, type RentcastComp } from '@/hooks/useRentcastComps';
import { CompPickerMap, KIND_COLOR, type PickerKind, type PickerPin } from './CompPickerMap';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import type { Lead } from '@/types/domain';

type TaggedComp = RentcastComp & { kind: PickerKind };

export interface AddedComp {
  kind: 'sold' | 'listing';
  address: string | null;
  price: number | null;
  sale_date: string | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  distance: string | null;
  lat: number;
  lng: number;
}

const KIND_LABEL: Record<PickerKind, string> = { listing: 'Listed', sold: 'Sold', rental: 'Rental' };
const BED_BATH_OPTIONS = [1, 2, 3, 4, 5];
const RADIUS_OPTIONS = [0.5, 1, 2, 3, 5];
const TIMELINE_PRESETS = [
  { label: 'Last 3 months', days: 90 },
  { label: 'Last 6 months', days: 180 },
  { label: 'Last 1 year', days: 365 },
  { label: 'Last 2 years', days: 730 },
  { label: 'Custom…', days: -1 },
];

function buildAddress(lead: Lead): string {
  return [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ');
}

function daysSince(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

function DetailCard({ comp, isAdded, onToggle }: { comp: TaggedComp; isAdded: boolean; onToggle: () => void }) {
  const spec = [
    comp.beds != null ? `${comp.beds} bd` : null,
    comp.baths != null ? `${comp.baths} ba` : null,
    comp.sqft != null ? `${comp.sqft.toLocaleString()} sqft` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const spec2 = [
    comp.yearBuilt != null ? `Built ${comp.yearBuilt}` : null,
    comp.lotSize != null ? `${comp.lotSize.toLocaleString()} sqft lot` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="rounded-lg border border-border-2 bg-surface shadow-popover p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span
            className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ background: `${KIND_COLOR[comp.kind]}22`, color: KIND_COLOR[comp.kind] }}
          >
            {KIND_LABEL[comp.kind]}
          </span>
          <div className="mt-1 text-[14px] font-semibold text-text">{comp.address ?? 'Property'}</div>
          <div className="mt-1 text-[12.5px] text-text-3">
            {spec}
            {spec && (comp.distanceMiles != null || comp.date) ? ' · ' : ''}
            {comp.distanceMiles != null ? `${comp.distanceMiles} mi away` : ''}
            {comp.distanceMiles != null && comp.date ? ' · ' : ''}
            {comp.date ? `${comp.kind === 'sold' ? 'Sold' : 'Listed'} ${formatDate(comp.date)}` : ''}
          </div>
          {spec2 && <div className="mt-0.5 text-[12px] text-text-3">{spec2}</div>}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[17px] font-bold text-text">
            {formatCurrency(comp.price)}
            {comp.kind === 'rental' && <span className="text-[12px] font-normal text-text-3">/mo</span>}
          </div>
        </div>
      </div>
      {comp.kind === 'rental' ? (
        <p className="mt-2 text-[11.5px] text-text-3">Rental comps are reference only — this card can't be saved into Comparable Sales.</p>
      ) : (
        <button onClick={onToggle} className={cn('btn !mt-2.5 !w-full !justify-center !px-3 !py-1.5 text-[12.5px]', isAdded ? '' : 'btn-primary')}>
          {isAdded ? (
            <>
              <Check size={13} /> Added — click to remove
            </>
          ) : (
            'Add to Comparable Sales'
          )}
        </button>
      )}
    </div>
  );
}

/** AI Comping — fetches RentCast listing + sold + rental comps for this
 *  lead's address. The map is the primary surface, shown nearly full-screen;
 *  clicking a pin opens that property's detail card as a floating overlay on
 *  the map itself (Zillow-style), not pushed below it. Radius and the sale
 *  timeline are caller-adjustable and trigger a fresh RentCast call; kind,
 *  bed/bath/sqft/year-built/lot-size filters are all client-side against the
 *  already-fetched set. */
export function CompPickerModal({ lead, onClose, onAddComps }: { lead: Lead; onClose: () => void; onAddComps: (comps: AddedComp[]) => void }) {
  const fetchComps = useRentcastComps();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<'all' | PickerKind>('all');
  const [minBeds, setMinBeds] = useState<number | null>(null);
  const [minBaths, setMinBaths] = useState<number | null>(null);
  const [minSqft, setMinSqft] = useState<string>('');
  const [minYearBuilt, setMinYearBuilt] = useState<string>('');
  const [minLotSize, setMinLotSize] = useState<string>('');
  const [radiusMiles, setRadiusMiles] = useState(1);
  const [timelineDays, setTimelineDays] = useState(365);
  const [customFrom, setCustomFrom] = useState('');
  const address = buildAddress(lead);

  function runFetch(radius: number, days: number) {
    if (address) fetchComps.mutate({ address, radiusMiles: radius, saleDateRangeDays: days });
  }

  useEffect(() => {
    runFetch(radiusMiles, timelineDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const result = fetchComps.data;
  const allComps: TaggedComp[] = useMemo(() => {
    const listing = (result?.listingComps ?? []).map((c) => ({ ...c, kind: 'listing' as const }));
    const sold = (result?.soldComps ?? []).map((c) => ({ ...c, kind: 'sold' as const }));
    const rental = (result?.rentalComps ?? []).map((c) => ({ ...c, kind: 'rental' as const }));
    return [...listing, ...sold, ...rental].sort((a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999));
  }, [result]);

  const filteredComps = useMemo(() => {
    const sqftFloor = minSqft.trim() === '' ? null : Number(minSqft);
    const yearFloor = minYearBuilt.trim() === '' ? null : Number(minYearBuilt);
    const lotFloor = minLotSize.trim() === '' ? null : Number(minLotSize);
    return allComps.filter(
      (c) =>
        (kindFilter === 'all' || c.kind === kindFilter) &&
        (minBeds == null || (c.beds ?? 0) >= minBeds) &&
        (minBaths == null || (c.baths ?? 0) >= minBaths) &&
        (sqftFloor == null || (c.sqft ?? 0) >= sqftFloor) &&
        (yearFloor == null || (c.yearBuilt ?? 0) >= yearFloor) &&
        (lotFloor == null || (c.lotSize ?? 0) >= lotFloor),
    );
  }, [allComps, kindFilter, minBeds, minBaths, minSqft, minYearBuilt, minLotSize]);

  const pins: PickerPin[] = useMemo(
    () => filteredComps.map((c) => ({ id: c.id, kind: c.kind, address: c.address, price: c.price, sqft: c.sqft, beds: c.beds, baths: c.baths, lat: c.lat, lng: c.lng })),
    [filteredComps],
  );

  const activeComp = allComps.find((c) => c.id === activeId) ?? null;

  function handleTimelineChange(days: number) {
    setTimelineDays(days);
    if (days > 0) runFetch(radiusMiles, days);
  }

  function applyCustomFrom() {
    if (!customFrom) return;
    const days = daysSince(customFrom);
    setTimelineDays(days);
    runFetch(radiusMiles, days);
  }

  function handleRadiusChange(radius: number) {
    setRadiusMiles(radius);
    runFetch(radius, timelineDays > 0 ? timelineDays : daysSince(customFrom || new Date().toISOString()));
  }

  function handleAddSelected() {
    const chosen = allComps.filter((c) => selected.has(c.id) && c.kind !== 'rental') as (TaggedComp & { kind: 'sold' | 'listing' })[];
    onAddComps(
      chosen.map((c) => ({
        kind: c.kind,
        address: c.address,
        price: c.price,
        sale_date: c.kind === 'sold' ? c.date : null,
        sqft: c.sqft,
        beds: c.beds,
        baths: c.baths,
        distance: c.distanceMiles != null ? `${c.distanceMiles} mi` : null,
        lat: c.lat,
        lng: c.lng,
      })),
    );
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="AI Comping — RentCast" width="full">
      <div className="space-y-3">
        {!address && <div className="text-[13px] text-text-3">This lead needs an address before comps can be looked up.</div>}

        {fetchComps.isPending && <div className="py-10 text-center text-[13px] text-text-3">Looking up comps near {address}…</div>}

        {fetchComps.isError && (
          <div className="rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[13px] text-danger">
            {(fetchComps.error as Error).message}
            <div className="mt-2">
              <button className="btn !px-2 !py-1 text-[12px]" onClick={() => runFetch(radiusMiles, timelineDays)}>
                Retry
              </button>
            </div>
          </div>
        )}

        {result && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select className="input !w-auto !py-1 text-[12px]" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as any)}>
                <option value="all">All kinds</option>
                <option value="listing">Listed (on market)</option>
                <option value="sold">Sold</option>
                <option value="rental">Rental</option>
              </select>

              <select
                className="input !w-auto !py-1 text-[12px]"
                value={TIMELINE_PRESETS.find((p) => p.days === timelineDays) ? timelineDays : -1}
                onChange={(e) => handleTimelineChange(Number(e.target.value))}
              >
                {TIMELINE_PRESETS.map((p) => (
                  <option key={p.label} value={p.days}>
                    {p.label}
                  </option>
                ))}
              </select>
              {(!TIMELINE_PRESETS.find((p) => p.days === timelineDays) || timelineDays === -1) && (
                <>
                  <span className="text-[12px] text-text-3">from</span>
                  <input type="date" className="input !w-auto !py-1 text-[12px]" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                  <button className="btn !px-2 !py-1 text-[12px]" onClick={applyCustomFrom} disabled={!customFrom}>
                    Apply
                  </button>
                </>
              )}

              <select className="input !w-auto !py-1 text-[12px]" value={radiusMiles} onChange={(e) => handleRadiusChange(Number(e.target.value))}>
                {RADIUS_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r} mi radius
                  </option>
                ))}
              </select>

              <select className="input !w-auto !py-1 text-[12px]" value={minBeds ?? ''} onChange={(e) => setMinBeds(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Any beds</option>
                {BED_BATH_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}+ bd
                  </option>
                ))}
              </select>
              <select className="input !w-auto !py-1 text-[12px]" value={minBaths ?? ''} onChange={(e) => setMinBaths(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Any baths</option>
                {BED_BATH_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}+ ba
                  </option>
                ))}
              </select>
              <input className="input !w-[90px] !py-1 text-[12px]" placeholder="Min sqft" inputMode="numeric" value={minSqft} onChange={(e) => setMinSqft(e.target.value)} />
              <input className="input !w-[100px] !py-1 text-[12px]" placeholder="Built after" inputMode="numeric" value={minYearBuilt} onChange={(e) => setMinYearBuilt(e.target.value)} />
              <input className="input !w-[100px] !py-1 text-[12px]" placeholder="Min lot sqft" inputMode="numeric" value={minLotSize} onChange={(e) => setMinLotSize(e.target.value)} />

              <button className="btn !px-2.5 !py-1 text-[12px]" onClick={() => runFetch(radiusMiles, timelineDays > 0 ? timelineDays : daysSince(customFrom))} disabled={fetchComps.isPending}>
                Refresh
              </button>
              <span className="ml-auto text-[12px] text-text-3">
                {filteredComps.length} of {allComps.length} comps · {selected.size} selected
              </span>
            </div>

            <CompPickerMap
              pins={pins}
              subject={result.subject}
              selectedIds={selected}
              activeId={activeId}
              onSelect={setActiveId}
              overlay={activeComp && <DetailCard comp={activeComp} isAdded={selected.has(activeComp.id)} onToggle={() => toggle(activeComp.id)} />}
            />

            <div className="flex items-center justify-between border-t border-border pt-3">
              <p className="text-[11.5px] text-text-3">
                Listed = currently/recently for-sale. Sold = real closed sales in the selected window. Rental = active rental listings, reference only.
              </p>
              <button className="btn btn-primary !px-3 !py-1.5 text-[13px]" onClick={handleAddSelected} disabled={selected.size === 0}>
                Add Selected
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
