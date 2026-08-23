import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Home, Plus, Trash2 } from 'lucide-react';
import { useBuyerDeals, useCreateBuyerDeal, useDeleteBuyerDeal, type BuyerDealInput } from '@/hooks/useBuyerDeals';
import { useContractStageLeads } from '@/hooks/useLeads';
import { CardHeader } from '@/components/ui/CardHeader';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatCurrency, formatDate } from '@/lib/utils';

const MANUAL_ENTRY = '__manual__';

function AddDealModal({ buyerId, onClose }: { buyerId: string; onClose: () => void }) {
  const create = useCreateBuyerDeal(buyerId);
  const { data: contractLeads = [] } = useContractStageLeads();
  const [leadChoice, setLeadChoice] = useState(MANUAL_ENTRY);
  const [propertyAddress, setPropertyAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [closedDate, setClosedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selectedLead = useMemo(() => contractLeads.find((l) => l.id === leadChoice), [contractLeads, leadChoice]);

  function handlePickLead(id: string) {
    setLeadChoice(id);
    const lead = contractLeads.find((l) => l.id === id);
    if (!lead) return;
    setPropertyAddress(lead.address ?? '');
    setCity(lead.city ?? '');
    setState(lead.state ?? '');
    setSalePrice(lead.finalPrice != null ? String(lead.finalPrice) : lead.askingPrice != null ? String(lead.askingPrice) : '');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyAddress.trim()) return;
    setError(null);
    const input: BuyerDealInput = {
      leadId: selectedLead?.id ?? null,
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
          <label className="label">Assign a deal in contract</label>
          <select className="input" value={leadChoice} onChange={(e) => handlePickLead(e.target.value)}>
            <option value={MANUAL_ENTRY}>— Enter manually —</option>
            {contractLeads.map((l) => (
              <option key={l.id} value={l.id}>
                {[l.name, l.address, l.city].filter(Boolean).join(' — ') || l.name}
                {l.finalPrice != null ? ` (${formatCurrency(l.finalPrice)})` : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-text-3">
            {contractLeads.length === 0
              ? 'No leads are currently in the Contract stage.'
              : 'Picking one fills in the fields below from that deal — still editable before saving.'}
          </p>
        </div>
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
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-text">{d.propertyAddress}</span>
                  {d.leadId && (
                    <Link to={`/leads/${d.leadId}`} className="text-[11px] font-medium text-primary hover:underline">
                      View Lead
                    </Link>
                  )}
                </div>
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
