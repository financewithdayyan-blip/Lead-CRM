import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Facebook, Handshake, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCashBuyers, useDeleteCashBuyer, buyerMatchesSearchTarget } from '@/hooks/useCashBuyers';
import { CashBuyerModal } from '@/components/disposition/CashBuyerModal';
import { GeoMultiSelect } from '@/components/disposition/GeoMultiSelect';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { US_STATE_NAMES, cityStateOptions, resolveSearchTarget } from '@/data/usGeo';
import { BUYER_PROPERTY_TYPE_LABELS, DEAL_TYPE_CONFIG, type CashBuyer } from '@/types/domain';
import { externalHref, formatCurrency, formatPhone } from '@/lib/utils';

const MAX_MARKET_ENTRIES = 3;

function marketsLabel(buyer: CashBuyer): string {
  const entries = [...buyer.marketStates, ...buyer.marketCounties.map((c) => `${c} County`), ...buyer.marketCities];
  if (entries.length === 0) return 'Any market';
  if (entries.length <= MAX_MARKET_ENTRIES) return entries.join(', ');
  return `${entries.slice(0, MAX_MARKET_ENTRIES).join(', ')} +${entries.length - MAX_MARKET_ENTRIES} more`;
}

function priceRangeLabel(buyer: CashBuyer): string {
  if (buyer.priceMin == null && buyer.priceMax == null) return 'Any price';
  if (buyer.priceMin != null && buyer.priceMax != null) return `${formatCurrency(buyer.priceMin)} – ${formatCurrency(buyer.priceMax)}`;
  if (buyer.priceMin != null) return `${formatCurrency(buyer.priceMin)}+`;
  return `Up to ${formatCurrency(buyer.priceMax)}`;
}

export function DispositionPage() {
  const { data: buyers = [], isLoading, isError, error } = useCashBuyers();
  const deleteCashBuyer = useDeleteCashBuyer();

  const [locationSearch, setLocationSearch] = useState<string[]>([]);
  const [nameSearch, setNameSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | ''>('active');
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<CashBuyer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CashBuyer | null>(null);

  const locationOptions = useMemo(() => [...US_STATE_NAMES, ...cityStateOptions()], []);
  const searchTarget = useMemo(() => (locationSearch[0] ? resolveSearchTarget(locationSearch[0]) : null), [locationSearch]);

  const filtered = useMemo(() => {
    const q = nameSearch.trim().toLowerCase();
    return buyers.filter((b) => {
      if (statusFilter && b.status !== statusFilter) return false;
      if (searchTarget && !buyerMatchesSearchTarget(b, searchTarget)) return false;
      if (q) {
        const haystack = `${b.name} ${b.phone ?? ''} ${b.email ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [buyers, nameSearch, statusFilter, searchTarget]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Handshake size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-text">Disposition</h1>
            <p className="text-sm text-text-3">Cash buyer roster and deal matching</p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add Buyer
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-border-2 bg-surface-2 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-sm">
            <GeoMultiSelect
              label="Find buyers in a city or state"
              placeholder="Type a city or state…"
              options={locationOptions}
              selected={locationSearch}
              onChange={(next) => setLocationSearch(next.length > 0 ? [next[next.length - 1]] : [])}
            />
          </div>
          {locationSearch[0] && (
            <>
              <p className="pb-2 text-[12px] text-text-3">
                {filtered.length} buyer{filtered.length === 1 ? '' : 's'} cover{filtered.length === 1 ? 's' : ''} {locationSearch[0]}
              </p>
              <button className="mb-[3px] flex items-center gap-1 pb-2 text-[12px] text-text-3 hover:text-text" onClick={() => setLocationSearch([])}>
                <X size={12} /> Clear
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="input max-w-xs flex-1"
          placeholder="Or search by name, phone, email…"
          value={nameSearch}
          onChange={(e) => setNameSearch(e.target.value)}
        />
        <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'active' | 'inactive' | '')}>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
          <option value="">All statuses</option>
        </select>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-text-3">Loading buyers…</div>
      ) : isError ? (
        <div className="py-12 text-center text-sm text-danger">{(error as Error)?.message ?? 'Failed to load buyers.'}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-2 py-12 text-center text-sm text-text-3">
          {buyers.length === 0 ? 'No cash buyers yet — add your first one to start building the roster.' : 'No buyers match your search.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-2">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border-2 bg-surface-2 text-[11px] uppercase tracking-wide text-text-3">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Buyer</th>
                <th className="px-3 py-2.5 font-semibold">Markets</th>
                <th className="px-3 py-2.5 font-semibold">Property Types</th>
                <th className="px-3 py-2.5 font-semibold">Price Range</th>
                <th className="px-3 py-2.5 font-semibold">Deal Types</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-2">
              {filtered.map((b) => (
                <tr key={b.id} className="hover:bg-surface-2">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Link to={`/disposition/${b.id}`} className="font-medium text-text hover:text-primary hover:underline">
                        {b.name}
                      </Link>
                      {b.facebookUrl && (
                        <a
                          href={externalHref(b.facebookUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open Facebook profile"
                          className="text-[#1877F2] hover:opacity-70"
                        >
                          <Facebook size={14} />
                        </a>
                      )}
                    </div>
                    <div className="text-[12px] text-text-3">{[b.phone ? formatPhone(b.phone) : null, b.email].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="max-w-[220px] px-3 py-2.5 text-text-2">{marketsLabel(b)}</td>
                  <td className="px-3 py-2.5 text-text-2">
                    {b.propertyTypes.length > 0 ? b.propertyTypes.map((t) => BUYER_PROPERTY_TYPE_LABELS[t]).join(', ') : 'Any type'}
                  </td>
                  <td className="px-3 py-2.5 text-text-2">{priceRangeLabel(b)}</td>
                  <td className="px-3 py-2.5 text-text-2">
                    {b.dealTypes.length > 0 ? b.dealTypes.map((t) => DEAL_TYPE_CONFIG[t].label).join(', ') : 'Any structure'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        b.status === 'active' ? 'bg-success-dim text-success' : 'bg-surface-3 text-text-3'
                      }`}
                    >
                      {b.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button className="btn !p-1.5" title="Edit" onClick={() => setEditTarget(b)}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn !p-1.5" title="Delete" onClick={() => setDeleteTarget(b)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <CashBuyerModal onClose={() => setShowAdd(false)} />}
      {editTarget && <CashBuyerModal buyer={editTarget} onClose={() => setEditTarget(null)} />}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete buyer?"
        message={`Remove ${deleteTarget?.name ?? 'this buyer'} from the roster? This can't be undone.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteCashBuyer.mutate(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
