import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useCreateCashBuyer, useUpdateCashBuyer, type CashBuyerInput } from '@/hooks/useCashBuyers';
import { getErrorMessage } from '@/lib/utils';
import {
  BUYER_CONDITION_LABELS,
  BUYER_PROPERTY_TYPE_LABELS,
  DEAL_TYPE_CONFIG,
  type BuyerCondition,
  type BuyerPropertyType,
  type CashBuyer,
  type DealType,
} from '@/types/domain';

const PROPERTY_TYPES = Object.keys(BUYER_PROPERTY_TYPE_LABELS) as BuyerPropertyType[];
const DEAL_TYPES = Object.keys(DEAL_TYPE_CONFIG) as DealType[];
const CONDITIONS = Object.keys(BUYER_CONDITION_LABELS) as BuyerCondition[];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function CashBuyerModal({ buyer, onClose }: { buyer?: CashBuyer; onClose: () => void }) {
  const create = useCreateCashBuyer();
  const update = useUpdateCashBuyer();
  const isEdit = !!buyer;

  const [name, setName] = useState(buyer?.name ?? '');
  const [phone, setPhone] = useState(buyer?.phone ?? '');
  const [email, setEmail] = useState(buyer?.email ?? '');
  const [marketsText, setMarketsText] = useState(buyer?.markets.join(', ') ?? '');
  const [propertyTypes, setPropertyTypes] = useState<BuyerPropertyType[]>(buyer?.propertyTypes ?? []);
  const [priceMin, setPriceMin] = useState(buyer?.priceMin?.toString() ?? '');
  const [priceMax, setPriceMax] = useState(buyer?.priceMax?.toString() ?? '');
  const [minBeds, setMinBeds] = useState(buyer?.minBeds?.toString() ?? '');
  const [minBaths, setMinBaths] = useState(buyer?.minBaths?.toString() ?? '');
  const [condition, setCondition] = useState<BuyerCondition | ''>(buyer?.condition ?? '');
  const [dealTypes, setDealTypes] = useState<DealType[]>(buyer?.dealTypes ?? []);
  const [notes, setNotes] = useState(buyer?.notes ?? '');
  const [status, setStatus] = useState<'active' | 'inactive'>(buyer?.status ?? 'active');
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0;
  const pending = create.isPending || update.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    const input: CashBuyerInput = {
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      markets: marketsText.split(',').map((m) => m.trim()).filter(Boolean),
      propertyTypes,
      priceMin: priceMin ? Number(priceMin) : null,
      priceMax: priceMax ? Number(priceMax) : null,
      minBeds: minBeds ? Number(minBeds) : null,
      minBaths: minBaths ? Number(minBaths) : null,
      condition: condition || null,
      dealTypes,
      notes: notes.trim() || null,
      status,
    };
    try {
      if (isEdit) await update.mutateAsync({ id: buyer.id, ...input });
      else await create.mutateAsync(input);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to save this buyer.'));
    }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${buyer.name}` : 'Add Cash Buyer'} width="lg">
      {error && <div className="mb-4 rounded-md bg-danger-dim px-3 py-2 text-[13px] text-danger">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Name *</label>
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Markets / cities they buy in</label>
          <input
            className="input"
            placeholder="Tampa, Buffalo, Fayetteville"
            value={marketsText}
            onChange={(e) => setMarketsText(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-text-3">Comma-separated. Leave blank for no city restriction.</p>
        </div>

        <div>
          <label className="label">Property types</label>
          <div className="flex flex-wrap gap-1.5">
            {PROPERTY_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPropertyTypes((prev) => toggle(prev, t))}
                className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  propertyTypes.includes(t)
                    ? 'border-primary bg-primary-dim text-primary-text'
                    : 'border-border-2 bg-surface text-text-2 hover:bg-surface-3'
                }`}
              >
                {BUYER_PROPERTY_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-text-3">Leave all unselected for no property-type restriction.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Price min</label>
            <input className="input" type="number" inputMode="decimal" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} />
          </div>
          <div>
            <label className="label">Price max</label>
            <input className="input" type="number" inputMode="decimal" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} />
          </div>
          <div>
            <label className="label">Min beds</label>
            <input className="input" type="number" inputMode="decimal" value={minBeds} onChange={(e) => setMinBeds(e.target.value)} />
          </div>
          <div>
            <label className="label">Min baths</label>
            <input className="input" type="number" inputMode="decimal" value={minBaths} onChange={(e) => setMinBaths(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Condition preference</label>
          <select className="input" value={condition} onChange={(e) => setCondition(e.target.value as BuyerCondition | '')}>
            <option value="">No preference / not asked yet</option>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>{BUYER_CONDITION_LABELS[c]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Deal structures they'll do</label>
          <div className="flex flex-wrap gap-1.5">
            {DEAL_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setDealTypes((prev) => toggle(prev, t))}
                className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  dealTypes.includes(t)
                    ? 'border-accent bg-accent-dim text-accent-hover'
                    : 'border-border-2 bg-surface text-text-2 hover:bg-surface-3'
                }`}
              >
                {DEAL_TYPE_CONFIG[t].label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-text-3">Leave all unselected for no deal-type restriction.</p>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit || pending} className="btn btn-primary">
            {isEdit ? 'Save Changes' : 'Add Buyer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
