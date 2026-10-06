import { Trash2 } from 'lucide-react';
import { RepairPicker } from '@/components/packets/RepairPicker';
import { repairIcon } from '@/lib/repairCatalog';
import { useLeadRepairs, useCreateLeadRepair, useUpdateLeadRepair, useDeleteLeadRepair } from '@/hooks/useLeadRepairs';
import { formatCurrency } from '@/lib/utils';
import type { Lead } from '@/types/domain';

export function RepairEstimateSection({ lead }: { lead: Lead }) {
  const { data: repairs = [] } = useLeadRepairs(lead.id);
  const createRepair = useCreateLeadRepair();
  const updateRepair = useUpdateLeadRepair();
  const deleteRepair = useDeleteLeadRepair();

  const total = repairs.reduce((sum, r) => sum + r.cost, 0);
  const maxCost = Math.max(...repairs.map((r) => r.cost), 1);

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
                <input
                  className="input !w-20 shrink-0 !py-1 text-[12.5px]"
                  inputMode="decimal"
                  value={r.cost || ''}
                  placeholder="0"
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/[^0-9.]/g, ''));
                    if (!Number.isNaN(n)) updateRepair.mutate({ id: r.id, leadId: lead.id, cost: n });
                  }}
                />
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
    </div>
  );
}
