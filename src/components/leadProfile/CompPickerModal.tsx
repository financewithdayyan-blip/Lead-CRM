import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useRentcastComps, type RentcastComp } from '@/hooks/useRentcastComps';
import { CompPickerMap, type PickerPin } from './CompPickerMap';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import type { Lead } from '@/types/domain';

type Kind = 'sold' | 'listing';
type TaggedComp = RentcastComp & { kind: Kind };

export interface AddedComp {
  kind: Kind;
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

const KIND_COLOR: Record<Kind, string> = { listing: '#10b981', sold: '#f59e0b' };
const KIND_LABEL: Record<Kind, string> = { listing: 'Listing', sold: 'Sold' };

function buildAddress(lead: Lead): string {
  return [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ');
}

/** AI Comping — fetches RentCast listing + sold comps for this lead's
 *  address. The map is the primary surface (click a pin to select it
 *  directly); the list underneath is one unified, compact rundown rather
 *  than two separate side-by-side cards, so it reads as an extension of
 *  the map instead of a second, competing UI. */
export function CompPickerModal({ lead, onClose, onAddComps }: { lead: Lead; onClose: () => void; onAddComps: (comps: AddedComp[]) => void }) {
  const fetchComps = useRentcastComps();
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
    return [...listing, ...sold].sort((a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999));
  }, [result]);
  const pins: PickerPin[] = useMemo(
    () => allComps.map((c) => ({ id: c.id, kind: c.kind, address: c.address, price: c.price, sqft: c.sqft, beds: c.beds, baths: c.baths, lat: c.lat, lng: c.lng })),
    [allComps],
  );

  function handleAddSelected() {
    const chosen = allComps.filter((c) => selected.has(c.id));
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
            <p className="text-[12px] text-text-3">
              Listing comps are currently/recently for-sale asking prices. Sold comps are real recorded closed sales from the last 6-24 months.
              Click a pin on the map, or a row below, to add/remove it.
            </p>

            <CompPickerMap pins={pins} subject={result.subject} selectedIds={selected} onToggle={toggle} />

            <div className="max-h-[260px] divide-y divide-border overflow-y-auto rounded-md border border-border-2">
              {allComps.length === 0 && <div className="px-3 py-6 text-center text-[12.5px] text-text-3">No comps found nearby.</div>}
              {allComps.map((c) => {
                const isSelected = selected.has(c.id);
                const spec = [c.beds != null ? `${c.beds} bd` : null, c.baths != null ? `${c.baths} ba` : null, c.sqft != null ? `${c.sqft.toLocaleString()} sqft` : null]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors', isSelected ? 'bg-primary-dim' : 'hover:bg-surface-3')}
                  >
                    <span
                      className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', isSelected ? 'border-primary bg-primary' : 'border-border-2')}
                    >
                      {isSelected && <span className="h-1.5 w-1.5 rounded-sm bg-white" />}
                    </span>
                    <span
                      className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ background: `${KIND_COLOR[c.kind]}22`, color: KIND_COLOR[c.kind] }}
                    >
                      {KIND_LABEL[c.kind]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-text">{c.address ?? 'Property'}</span>
                    <span className="shrink-0 text-[12.5px] font-semibold text-text-2">{formatCurrency(c.price)}</span>
                    <span className="hidden shrink-0 text-[11.5px] text-text-3 sm:inline">{spec}</span>
                    {c.distanceMiles != null && <span className="hidden shrink-0 text-[11.5px] text-text-3 md:inline">{c.distanceMiles} mi</span>}
                    {c.date && <span className="hidden shrink-0 text-[11.5px] text-text-3 md:inline">{formatDate(c.date)}</span>}
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
