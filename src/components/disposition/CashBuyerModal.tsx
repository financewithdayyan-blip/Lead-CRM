import { useMemo, useState } from 'react';
import { Facebook, TriangleAlert } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { GeoMultiSelect } from '@/components/disposition/GeoMultiSelect';
import { useCashBuyers, useCreateCashBuyer, useUpdateCashBuyer, type CashBuyerInput } from '@/hooks/useCashBuyers';
import { US_STATE_NAMES, citiesForStates, countiesForStates } from '@/data/usGeo';
import { externalHref, getErrorMessage, normalizeFacebookUrl } from '@/lib/utils';
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
  const { data: allBuyers = [] } = useCashBuyers();
  const isEdit = !!buyer;

  const [name, setName] = useState(buyer?.name ?? '');
  const [phone, setPhone] = useState(buyer?.phone ?? '');
  const [email, setEmail] = useState(buyer?.email ?? '');
  const [facebookUrl, setFacebookUrl] = useState(buyer?.facebookUrl ?? '');
  const [marketStates, setMarketStates] = useState<string[]>(buyer?.marketStates ?? []);
  const [marketCounties, setMarketCounties] = useState<string[]>(buyer?.marketCounties ?? []);
  const [marketCities, setMarketCities] = useState<string[]>(buyer?.marketCities ?? []);
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

  const pending = create.isPending || update.isPending;

  const countyOptions = useMemo(() => countiesForStates(marketStates), [marketStates]);
  const cityOptions = useMemo(() => citiesForStates(marketStates), [marketStates]);

  // Duplicate-entry guard: a Facebook link matching another buyer is close
  // to certain proof of the same real person (two different real profiles
  // can't share a URL), so that one blocks saving outright. A name-only
  // match was tried and dropped — two genuinely different buyers with the
  // same name (buying in different markets) are common enough in practice
  // that it produced real false positives.
  const others = useMemo(() => allBuyers.filter((b) => b.id !== buyer?.id), [allBuyers, buyer?.id]);
  const facebookDuplicate = useMemo(() => {
    const norm = facebookUrl.trim() ? normalizeFacebookUrl(facebookUrl) : '';
    if (!norm) return null;
    return others.find((b) => b.facebookUrl && normalizeFacebookUrl(b.facebookUrl) === norm) ?? null;
  }, [others, facebookUrl]);

  const canSubmit = name.trim().length > 0 && !facebookDuplicate;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    const input: CashBuyerInput = {
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      facebookUrl: facebookUrl.trim() || null,
      marketStates,
      marketCounties,
      marketCities,
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

        {facebookDuplicate && (
          <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[12px] text-danger">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            <span>
              This Facebook profile is already saved for <strong>{facebookDuplicate.name}</strong> — saving is disabled to avoid a duplicate.
              Edit that buyer instead, or clear the Facebook link here if this is genuinely a different person.
            </span>
          </div>
        )}

        <div>
          <label className="label">Facebook profile</label>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="facebook.com/their.profile"
              value={facebookUrl}
              onChange={(e) => setFacebookUrl(e.target.value)}
            />
            <a
              href={facebookUrl.trim() ? externalHref(facebookUrl.trim()) : undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!facebookUrl.trim()}
              className={`btn !px-2.5 ${facebookUrl.trim() ? 'text-[#1877F2]' : 'pointer-events-none opacity-40'}`}
              title="Open Facebook profile"
            >
              <Facebook size={16} />
            </a>
          </div>
          <p className="mt-1 text-[11px] text-text-3">Link to their profile or the group post so you can jump straight to DMing them.</p>
        </div>

        <div className="space-y-4 rounded-md border border-border-2 bg-surface-3 p-3">
          <GeoMultiSelect
            label="States they buy in"
            placeholder="Type to search states…"
            options={US_STATE_NAMES}
            selected={marketStates}
            onChange={(next) => {
              setMarketStates(next);
              // Dropping a state should drop any county/city picks that only made
              // sense under it, so the two lists never disagree about coverage.
              const stillValidCounties = countiesForStates(next);
              const stillValidCities = citiesForStates(next);
              setMarketCounties((prev) => prev.filter((c) => next.length === 0 || stillValidCounties.includes(c)));
              setMarketCities((prev) => prev.filter((c) => next.length === 0 || stillValidCities.includes(c)));
            }}
            hint="Matches any deal in that state, even outside the cities below."
          />
          <GeoMultiSelect
            label="Counties (reference only)"
            placeholder={marketStates.length > 0 ? 'Type to search counties…' : 'Type to search all US counties…'}
            options={countyOptions}
            selected={marketCounties}
            onChange={setMarketCounties}
            hint="Not used for automatic matching yet — just here so you can see a buyer's declared range."
          />
          <GeoMultiSelect
            label="Cities they buy in"
            placeholder={marketStates.length > 0 ? 'Type to search cities…' : 'Type to search all US cities…'}
            options={cityOptions}
            selected={marketCities}
            onChange={setMarketCities}
            hint="Leave blank for no city restriction. Not listed? Type it and hit Enter to add it anyway."
          />
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
