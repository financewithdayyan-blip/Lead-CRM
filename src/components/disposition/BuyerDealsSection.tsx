import { useState } from 'react';
import { Home, Plus, Trash2 } from 'lucide-react';
import { useBuyerDeals, useCreateBuyerDeal, useDeleteBuyerDeal, type BuyerDealInput } from '@/hooks/useBuyerDeals';
import { CardHeader } from '@/components/ui/CardHeader';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatCurrency, formatDate } from '@/lib/utils';

function AddDealModal({ buyerId, onClose }: { buyerId: string; onClose: () => void }) {
  const create = useCreateBuyerDeal(buyerId);
  const [propertyAddress, setPropertyAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [closedDate, setClosedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyAddress.trim()) return;
    setError(null);
    const input: BuyerDealInput = {
      propertyAddress: propertyAddress.trim(),
      city: city.trim() || null,
      state: state.trim() || null,
      salePrice: salePrice ? Number(salePrice) : null,
      closedDate: closedDate || null,
      notes: notes.trim() || null,
    };
    try {
      await create.mutateAsync(input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save this deal.');
    }
  }

  return (
    <Modal open onClose={onClose} title="Add Deal" width="sm">
      {error && <div className="mb-4 rounded-md bg-danger-dim px-3 py-2 text-[13px] text-danger">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Property Address *</label>
          <input className="input" required value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">City</label>
            <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div>
            <label className="label">State</label>
            <input className="input" value={state} onChange={(e) => setState(e.target.value)} />
          </div>
          <div>
            <label className="label">Sale Price</label>
            <input className="input" type="number" inputMode="decimal" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
          </div>
          <div>
            <label className="label">Closed Date</label>
            <input className="input" type="date" value={closedDate} onChange={(e) => setClosedDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={!propertyAddress.trim() || create.isPending} className="btn btn-primary">
            Add Deal
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function BuyerDealsSection({ buyerId }: { buyerId: string }) {
  const { data: deals = [], isLoading } = useBuyerDeals(buyerId);
  const deleteDeal = useDeleteBuyerDeal(buyerId);
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const totalVolume = deals.reduce((sum, d) => sum + (d.salePrice ?? 0), 0);

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <CardHeader icon={Home} title="Deals Bought" sub={deals.length > 0 ? `${deals.length} deal${deals.length === 1 ? '' : 's'} · ${formatCurrency(totalVolume)} total` : undefined} tone="success" />
        <button className="btn" onClick={() => setShowAdd(true)}>
          <Plus size={13} /> Add Deal
        </button>
      </div>

      {isLoading ? (
        <div className="mt-4 text-[13px] text-text-3">Loading…</div>
      ) : deals.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-border-2 py-6 text-center text-[13px] text-text-3">
          No deals logged yet for this buyer.
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {deals.map((d) => (
            <div key={d.id} className="flex items-start justify-between gap-3 rounded-md border border-border-2 p-3">
              <div className="min-w-0">
                <div className="font-medium text-text">{d.propertyAddress}</div>
                <div className="text-[12px] text-text-3">
                  {[d.city, d.state].filter(Boolean).join(', ')}
                  {d.closedDate ? ` · Closed ${formatDate(d.closedDate)}` : ''}
                </div>
                {d.notes && <div className="mt-1 text-[12px] text-text-2">{d.notes}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {d.salePrice != null && <span className="font-semibold text-text">{formatCurrency(d.salePrice)}</span>}
                <button className="btn !p-1.5" title="Delete" onClick={() => setDeleteTarget(d.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddDealModal buyerId={buyerId} onClose={() => setShowAdd(false)} />}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this deal?"
        message="This can't be undone."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteDeal.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
