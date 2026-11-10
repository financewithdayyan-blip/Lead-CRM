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

function buildAddress(lead: Lead): string {
  return [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ');
}

function DetailCard({ comp, isAdded, onToggle }: { comp: TaggedComp; isAdded: boolean; onToggle: () => void }) {
  const spec = [comp.beds != null ? `${comp.beds} bd` : null, comp.baths != null ? `${comp.baths} ba` : null, comp.sqft != null ? `${comp.sqft.toLocaleString()} sqft` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="rounded-lg border border-border-2 bg-surface-3 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span
            className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ background: `${KIND_COLOR[comp.kind]}22`, color: KIND_COLOR[comp.kind] }}
          >
            {KIND_LABEL[comp.kind]}
          </span>
          <div className="mt-1 truncate text-[14px] font-semibold text-text">{comp.address ?? 'Property'}</div>
          <div className="mt-1 text-[12.5px] text-text-3">
            {spec}
            {spec && (comp.distanceMiles != null || comp.date) ? ' · ' : ''}
            {comp.distanceMiles != null ? `${comp.distanceMiles} mi away` : ''}
            {comp.distanceMiles != null && comp.date ? ' · ' : ''}
            {comp.date ? `${comp.kind === 'sold' ? 'Sold' : 'Listed'} ${formatDate(comp.date)}` : ''}
          </div>
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
        <button onClick={onToggle} className={cn('btn !mt-2.5 !px-3 !py-1.5 text-[12.5px]', isAdded ? '' : 'btn-primary')}>
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
 *  lead's address. The map is the primary surface: clicking a pin opens
 *  that property's detail card (with the actual add/remove action), and
 *  the compact list underneath is just a scannable index into the same
 *  pins — it doesn't carry its own separate selection UI. */
export function CompPickerModal({ lead, onClose, onAddComps }: { lead: Lead; onClose: () => void; onAddComps: (comps: AddedComp[]) => void }) {
  const fetchComps = useRentcastComps();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [minBeds, setMinBeds] = useState<number | null>(null);
  const [minBaths, setMinBaths] = useState<number | null>(null);
  const address = buildAddress(lead);

  useEffect(() => {
    if (address) fetchComps.mutate(address);
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

  const filteredComps = useMemo(
    () =>
      allComps.filter(
        (c) => (minBeds == null || (c.beds ?? 0) >= minBeds) && (minBaths == null || (c.baths ?? 0) >= minBaths),
      ),
    [allComps, minBeds, minBaths],
  );

  const pins: PickerPin[] = useMemo(
    () => filteredComps.map((c) => ({ id: c.id, kind: c.kind, address: c.address, price: c.price, sqft: c.sqft, beds: c.beds, baths: c.baths, lat: c.lat, lng: c.lng })),
    [filteredComps],
  );

  const activeComp = allComps.find((c) => c.id === activeId) ?? null;

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
    <Modal open onClose={onClose} title="AI Comping — RentCast" width="xl">
      <div className="space-y-3">
        {!address && <div className="text-[13px] text-text-3">This lead needs an address before comps can be looked up.</div>}

        {fetchComps.isPending && <div className="py-10 text-center text-[13px] text-text-3">Looking up comps near {address}…</div>}

        {fetchComps.isError && (
          <div className="rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[13px] text-danger">
            {(fetchComps.error as Error).message}
            <div className="mt-2">
              <button className="btn !px-2 !py-1 text-[12px]" onClick={() => fetchComps.mutate(address)}>
                Retry
              </button>
            </div>
          </div>
        )}

        {result && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] text-text-3">
                Listed = currently/recently for-sale. Sold = real closed sales, last 12 months. Rental = active rental listings, reference only.
              </p>
              <div className="flex items-center gap-2">
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
              </div>
            </div>

            <CompPickerMap pins={pins} subject={result.subject} selectedIds={selected} activeId={activeId} onSelect={setActiveId} />

            {activeComp && <DetailCard comp={activeComp} isAdded={selected.has(activeComp.id)} onToggle={() => toggle(activeComp.id)} />}

            <div className="max-h-[200px] divide-y divide-border overflow-y-auto rounded-md border border-border-2">
              {filteredComps.length === 0 && <div className="px-3 py-6 text-center text-[12.5px] text-text-3">No comps match these filters.</div>}
              {filteredComps.map((c) => {
                const isAdded = selected.has(c.id);
                const isActive = c.id === activeId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveId(c.id)}
                    className={cn('flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors', isActive ? 'bg-primary-dim' : 'hover:bg-surface-3')}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[c.kind] }} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-text">{c.address ?? 'Property'}</span>
                    <span className="shrink-0 text-[12.5px] font-semibold text-text-2">
                      {formatCurrency(c.price)}
                      {c.kind === 'rental' ? '/mo' : ''}
                    </span>
                    <span className="hidden shrink-0 text-[11.5px] text-text-3 md:inline">{c.distanceMiles != null ? `${c.distanceMiles} mi` : ''}</span>
                    {isAdded && <Check size={13} className="shrink-0 text-success" />}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-border pt-3">
              <button className="btn !px-2.5 !py-1.5 text-[12px]" onClick={() => fetchComps.mutate(address)} disabled={fetchComps.isPending}>
                Refresh
              </button>
              <div className="flex items-center gap-3">
                <span className="text-[12.5px] text-text-3">{selected.size} selected</span>
                <button className="btn btn-primary !px-3 !py-1.5 text-[13px]" onClick={handleAddSelected} disabled={selected.size === 0}>
                  Add Selected
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
