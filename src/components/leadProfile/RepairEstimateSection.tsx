import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { RepairPicker } from '@/components/packets/RepairPicker';
import { repairIcon } from '@/lib/repairCatalog';
import { useLeadRepairs, useCreateLeadRepair, useUpdateLeadRepair, useDeleteLeadRepair } from '@/hooks/useLeadRepairs';
import { useUpdateLead } from '@/hooks/useLeads';
import { formatCurrency } from '@/lib/utils';
import type { LeadRepair } from '@/types/domain';
import type { Lead } from '@/types/domain';

// MAO = ARV x 90% - (2x repairs — a conservative multiplier since actual
// rehab cost commonly runs double the initial estimate) - a flat $10k
// minimum wholesale fee.
const MAO_ARV_PCT = 0.9;
const MAO_REPAIR_MULTIPLIER = 2;
const MAO_MIN_FEE = 10000;

/** Local-buffered so typing a cost doesn't fire a mutation (and a cache
 *  invalidation + refetch) on every keystroke — committing on blur means one
 *  request per edit instead of one per digit, and avoids the final saved
 *  value depending on which keystroke's request happens to resolve last. */
function RepairCostInput({ repair, onCommit }: { repair: LeadRepair; onCommit: (cost: number) => void }) {
  const [value, setValue] = useState(repair.cost ? String(repair.cost) : '');

  function commit() {
    const n = Number(value.replace(/[^0-9.]/g, ''));
    if (!Number.isNaN(n) && n !== repair.cost) onCommit(n);
  }

  return (
    <input
      className="input !w-20 shrink-0 !py-1 text-[12.5px]"
      inputMode="decimal"
      value={value}
      placeholder="0"
      onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

export function RepairEstimateSection({ lead }: { lead: Lead }) {
  const { data: repairs = [] } = useLeadRepairs(lead.id);
  const createRepair = useCreateLeadRepair();
  const updateRepair = useUpdateLeadRepair();
  const deleteRepair = useDeleteLeadRepair();
  const updateLead = useUpdateLead();
  const [offerApplied, setOfferApplied] = useState(false);

  const total = repairs.reduce((sum, r) => sum + r.cost, 0);
  const maxCost = Math.max(...repairs.map((r) => r.cost), 1);
  const mao = lead.arv != null ? lead.arv * MAO_ARV_PCT - MAO_REPAIR_MULTIPLIER * total - MAO_MIN_FEE : null;

  function handleAdd(item: string) {
    createRepair.mutate({ leadId: lead.id, item, cost: 0, sortOrder: repairs.length });
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Repair Estimate</div>
        <div className="text-[15px] font-semibold text-text">{formatCurrency(total)}</div>
      </div>

      {repairs.length === 0 ? (
        <div className="mt-3 text-[13px] text-text-3">No repair items added yet.</div>
      ) : (
        <div className="mt-3 space-y-2.5">
          {repairs.map((r) => {
            const Icon = repairIcon(r.item);
            return (
              <div key={r.id} className="group flex items-center gap-2.5">
                <Icon size={14} className="shrink-0 text-text-3" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] text-text">{r.item}</span>
                    <span className="shrink-0 text-[13px] font-medium text-text">{formatCurrency(r.cost)}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border-2">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(r.cost / maxCost) * 100}%` }} />
                  </div>
                </div>
                <RepairCostInput repair={r} onCommit={(cost) => updateRepair.mutate({ id: r.id, leadId: lead.id, cost })} />
                <button
                  className="shrink-0 text-text-3 opacity-0 hover:text-danger group-hover:opacity-100"
                  onClick={() => deleteRepair.mutate({ id: r.id, leadId: lead.id })}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3">
        <RepairPicker existingItems={repairs.map((r) => r.item)} onAdd={handleAdd} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
        <div className="text-[13px] text-text-2">
          Max Allowable Offer <span className="text-[11.5px] text-text-3">(ARV × 90% − 2× repairs − $10k fee)</span>:{' '}
          <span className={`font-semibold ${mao != null && mao < 0 ? 'text-danger' : 'text-text'}`}>
            {mao != null ? formatCurrency(mao) : '— (set ARV first)'}
          </span>
        </div>
        {mao != null && (
          <button
            className="text-[12px] font-medium text-primary hover:underline"
            onClick={() =>
              updateLead.mutate(
                { id: lead.id, maxOffer: Math.round(mao) },
                { onSuccess: () => { setOfferApplied(true); setTimeout(() => setOfferApplied(false), 2000); } },
              )
            }
            disabled={updateLead.isPending}
          >
            {offerApplied ? '✓ Set as Cash Offer' : 'Use this as Cash Offer'}
          </button>
        )}
      </div>
    </div>
  );
}
