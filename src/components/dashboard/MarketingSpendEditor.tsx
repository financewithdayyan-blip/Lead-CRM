import { useState } from 'react';
import { DollarSign, Trash2 } from 'lucide-react';
import { useMarketingSpend, useCreateMarketingSpend, useDeleteMarketingSpend } from '@/hooks/useMarketingSpend';
import { LEAD_SOURCE_SUGGESTIONS } from '@/lib/leadSources';
import { CardHeader } from '@/components/ui/CardHeader';

/** Log/delete the spend entries the "Spend & Source Coverage" card above
 * summarizes — moved here from Settings so managing spend sits next to the
 * reporting it actually feeds instead of a separate, unrelated page. */
export function MarketingSpendEditor() {
  const { data: marketingSpend = [] } = useMarketingSpend();
  const createMarketingSpend = useCreateMarketingSpend();
  const deleteMarketingSpend = useDeleteMarketingSpend();
  const [spendForm, setSpendForm] = useState({ source: '', amount: '', periodStart: '', periodEnd: '', notes: '' });
  const [spendError, setSpendError] = useState<string | null>(null);

  function handleAddSpend() {
    setSpendError(null);
    if (!spendForm.source.trim() || !spendForm.amount || !spendForm.periodStart || !spendForm.periodEnd) {
      setSpendError('Source, amount, and both dates are required.');
      return;
    }
    createMarketingSpend.mutate(
      {
        source: spendForm.source.trim(),
        amount: Number(spendForm.amount),
        periodStart: spendForm.periodStart,
        periodEnd: spendForm.periodEnd,
        notes: spendForm.notes.trim() || undefined,
      },
      { onSuccess: () => setSpendForm({ source: '', amount: '', periodStart: '', periodEnd: '', notes: '' }) },
    );
  }

  return (
    <div className="card">
      <CardHeader icon={DollarSign} title="Spend by Source" tone="accent" />
      <p className="mt-1 text-[13px] text-text-2">
        Log what you spend acquiring leads, by source and period — feeds the Cost Per Lead / CAC numbers above once
        enough entries exist.
      </p>

      {marketingSpend.length === 0 ? (
        <div className="mt-3 text-[13px] text-text-3">No spend logged yet.</div>
      ) : (
        <div className="mt-3 space-y-1.5">
          {marketingSpend.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-md border border-border-2 bg-surface-3 px-3 py-2 text-[13px]">
              <div className="flex-1 font-medium text-text">{s.source}</div>
              <div className="text-text-2">${Number(s.amount).toLocaleString()}</div>
              <div className="text-text-3">
                {s.periodStart} – {s.periodEnd}
              </div>
              <button onClick={() => deleteMarketingSpend.mutate(s.id)} className="text-text-3 hover:text-danger" title="Delete entry">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="my-4 border-t border-border" />

      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Log spend</div>
      {spendError && <div className="mt-1.5 text-[12px] text-danger">{spendError}</div>}
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Source</label>
          <input
            className="input"
            list="lead-source-suggestions"
            placeholder="e.g. Cold Call"
            value={spendForm.source}
            onChange={(e) => setSpendForm((f) => ({ ...f, source: e.target.value }))}
          />
          <datalist id="lead-source-suggestions">
            {LEAD_SOURCE_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="label">Amount ($)</label>
          <input
            className="input w-28"
            type="number"
            value={spendForm.amount}
            onChange={(e) => setSpendForm((f) => ({ ...f, amount: e.target.value }))}
          />
        </div>
        <div>
          <label className="label">Period start</label>
          <input
            className="input"
            type="date"
            value={spendForm.periodStart}
            onChange={(e) => setSpendForm((f) => ({ ...f, periodStart: e.target.value }))}
          />
        </div>
        <div>
          <label className="label">Period end</label>
          <input
            className="input"
            type="date"
            value={spendForm.periodEnd}
            onChange={(e) => setSpendForm((f) => ({ ...f, periodEnd: e.target.value }))}
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="label">Notes (optional)</label>
          <input className="input" value={spendForm.notes} onChange={(e) => setSpendForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>
        <button className="btn btn-primary" disabled={createMarketingSpend.isPending} onClick={handleAddSpend}>
          {createMarketingSpend.isPending ? 'Adding…' : 'Add entry'}
        </button>
      </div>
    </div>
  );
}
