import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useUpdateLead, useUpsertComps } from '@/hooks/useLeads';
import { estimateComparableArv } from '@/hooks/useDealPackets';
import { formatCurrency } from '@/lib/utils';
import type { Comp, CompKind, Lead } from '@/types/domain';

type CompRow = {
  kind: CompKind;
  address: string | null;
  price: number | null;
  sale_date: string | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  distance: string | null;
  notes: string | null;
};

const KIND_LABEL: Record<CompKind, string> = { as_is: 'As-Is', sold: 'Sold', listing: 'Listing' };

function toRow(c: Comp): CompRow {
  return { kind: c.kind, address: c.address, price: c.price, sale_date: c.saleDate, sqft: c.sqft, beds: c.beds, baths: c.baths, distance: c.distance, notes: c.notes };
}

function num(v: string): number | null {
  const n = Number(v);
  return v.trim() === '' || Number.isNaN(n) ? null : n;
}

const EMPTY_ROW = (kind: CompKind): CompRow => ({ kind, address: '', price: null, sale_date: null, sqft: null, beds: null, baths: null, distance: null, notes: null });

export function LeadCompsSection({ lead }: { lead: Lead }) {
  const upsertComps = useUpsertComps();
  const updateLead = useUpdateLead();
  const [rows, setRows] = useState<CompRow[]>(() => (lead.comps ?? []).map(toRow));
  const [saved, setSaved] = useState(false);
  const [arvApplied, setArvApplied] = useState(false);

  const suggested = useMemo(
    () => estimateComparableArv(rows.map((r) => ({ kind: r.kind, salePrice: r.price, sqft: r.sqft })), lead.sqft),
    [rows, lead.sqft],
  );

  function updateRow(i: number, patch: Partial<CompRow>) {
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function handleSave() {
    upsertComps.mutate(
      { leadId: lead.id, comps: rows },
      { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000); } },
    );
  }

  const grouped: Array<[CompKind, CompRow[], number[]]> = (['as_is', 'sold', 'listing'] as CompKind[]).map((kind) => {
    const indices = rows.map((r, i) => (r.kind === kind ? i : -1)).filter((i) => i >= 0);
    return [kind, indices.map((i) => rows[i]), indices];
  });

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Comparable Sales</div>
        <button className="btn btn-primary !px-3 !py-1 text-[12px]" onClick={handleSave} disabled={upsertComps.isPending}>
          {saved ? '✓ Saved' : upsertComps.isPending ? 'Saving…' : 'Save Comps'}
        </button>
      </div>

      <p className="mt-2 text-[12px] text-text-3">
        As-Is and Sold comps anchor the suggested ARV; Listings are asking prices shown for reference only.
      </p>

      <div className="mt-3 space-y-4">
        {grouped.map(([kind, kindRows, indices]) => (
          <div key={kind}>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">{KIND_LABEL[kind]} comps</div>
            <div className="space-y-1.5">
              {kindRows.map((r, j) => {
                const i = indices[j];
                return (
                  <div key={i} className="grid grid-cols-[1fr_96px_92px_64px_46px_46px_80px_auto] items-center gap-1.5">
                    <input className="input !py-1 text-[12.5px]" placeholder="Address" value={r.address ?? ''} onChange={(e) => updateRow(i, { address: e.target.value })} />
                    <input className="input !py-1 text-[12.5px]" placeholder="Price" inputMode="numeric" value={r.price ?? ''} onChange={(e) => updateRow(i, { price: num(e.target.value) })} />
                    <input className="input !py-1 text-[12.5px]" type="date" value={r.sale_date ?? ''} onChange={(e) => updateRow(i, { sale_date: e.target.value || null })} />
                    <input className="input !py-1 text-[12.5px]" placeholder="Sqft" inputMode="numeric" value={r.sqft ?? ''} onChange={(e) => updateRow(i, { sqft: num(e.target.value) })} />
                    <input className="input !py-1 text-[12.5px]" placeholder="Bd" inputMode="decimal" value={r.beds ?? ''} onChange={(e) => updateRow(i, { beds: num(e.target.value) })} />
                    <input className="input !py-1 text-[12.5px]" placeholder="Ba" inputMode="decimal" value={r.baths ?? ''} onChange={(e) => updateRow(i, { baths: num(e.target.value) })} />
                    <input className="input !py-1 text-[12.5px]" placeholder="Distance" value={r.distance ?? ''} onChange={(e) => updateRow(i, { distance: e.target.value })} />
                    <button type="button" onClick={() => setRows((p) => p.filter((_, idx) => idx !== i))} className="rounded p-1 text-text-3 hover:text-danger" title="Remove">
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
            <button type="button" className="btn !mt-1.5 !px-2 !py-1 text-[11.5px]" onClick={() => setRows((p) => [...p, EMPTY_ROW(kind)])}>
              <Plus size={12} /> Add {KIND_LABEL[kind].toLowerCase()} comp
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
        <div className="text-[13px] text-text-2">
          Suggested ARV from comps:{' '}
          <span className="font-semibold text-text">{suggested ? formatCurrency(suggested.value) : '—'}</span>
          {suggested && <span className="ml-1.5 text-[11.5px] text-text-3">({suggested.soldCount} comp{suggested.soldCount === 1 ? '' : 's'})</span>}
        </div>
        {suggested && (
          <button
            className="text-[12px] font-medium text-primary hover:underline"
            onClick={() =>
              updateLead.mutate(
                { id: lead.id, arv: suggested.value },
                { onSuccess: () => { setArvApplied(true); setTimeout(() => setArvApplied(false), 2000); } },
              )
            }
            disabled={updateLead.isPending}
          >
            {arvApplied ? '✓ Set as lead ARV' : 'Use this as lead ARV'}
          </button>
        )}
      </div>
    </div>
  );
}
