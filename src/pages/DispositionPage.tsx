import { lazy, Suspense, useMemo, useState } from 'react';
import { Facebook, Handshake, List, MapPin, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCashBuyers, useDeleteCashBuyer, buyerMatchesPacket } from '@/hooks/useCashBuyers';
import { useAllDealPackets } from '@/hooks/useDealPackets';
import { CashBuyerModal } from '@/components/disposition/CashBuyerModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { BUYER_PROPERTY_TYPE_LABELS, DEAL_TYPE_CONFIG, type CashBuyer } from '@/types/domain';
import { externalHref, formatCurrency, formatPhone } from '@/lib/utils';

// Leaflet + the ~200KB city-coordinate dataset only load when someone
// actually opens the Map tab, not on every Disposition page visit.
const BuyersMapView = lazy(() => import('@/components/disposition/BuyersMapView').then((m) => ({ default: m.BuyersMapView })));

function marketsLabel(buyer: CashBuyer): string {
  const parts: string[] = [];
  if (buyer.marketStates.length > 0) parts.push(buyer.marketStates.join(', '));
  if (buyer.marketCounties.length > 0) parts.push(buyer.marketCounties.map((c) => `${c} County`).join(', '));
  if (buyer.marketCities.length > 0) parts.push(buyer.marketCities.join(', '));
  return parts.length > 0 ? parts.join(' · ') : 'Any market';
}

function priceRangeLabel(buyer: CashBuyer): string {
  if (buyer.priceMin == null && buyer.priceMax == null) return 'Any price';
  if (buyer.priceMin != null && buyer.priceMax != null) return `${formatCurrency(buyer.priceMin)} – ${formatCurrency(buyer.priceMax)}`;
  if (buyer.priceMin != null) return `${formatCurrency(buyer.priceMin)}+`;
  return `Up to ${formatCurrency(buyer.priceMax)}`;
}

export function DispositionPage() {
  const { data: buyers = [], isLoading, isError, error } = useCashBuyers();
  const { data: packets = [] } = useAllDealPackets();
  const deleteCashBuyer = useDeleteCashBuyer();

  const [view, setView] = useState<'list' | 'map'>('list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | ''>('active');
  const [dealId, setDealId] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<CashBuyer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CashBuyer | null>(null);

  const selectedPacket = useMemo(() => packets.find((p) => p.id === dealId) ?? null, [packets, dealId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return buyers.filter((b) => {
      if (statusFilter && b.status !== statusFilter) return false;
      if (selectedPacket && !buyerMatchesPacket(b, selectedPacket)) return false;
      if (q) {
        const haystack = `${b.name} ${b.marketStates.join(' ')} ${b.marketCounties.join(' ')} ${b.marketCities.join(' ')} ${b.phone ?? ''} ${b.email ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [buyers, search, statusFilter, selectedPacket]);

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
        <label className="label">Match against a deal</label>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input max-w-md" value={dealId} onChange={(e) => setDealId(e.target.value)}>
            <option value="">Show all buyers — no deal selected</option>
            {packets.map((p) => (
              <option key={p.id} value={p.id}>
                {[p.leadName, p.city, p.state].filter(Boolean).join(' · ') || 'Untitled deal'}
                {p.purchasePrice != null ? ` — ${formatCurrency(p.purchasePrice)}` : ''}
              </option>
            ))}
          </select>
          {selectedPacket && (
            <button className="btn !px-2 !py-1.5" onClick={() => setDealId('')} title="Clear">
              <X size={14} />
            </button>
          )}
        </div>
        {selectedPacket && (
          <p className="mt-2 text-[12px] text-text-3">
            Showing active buyers whose buy box matches this deal
            {selectedPacket.city ? ` in ${selectedPacket.city}` : ''}
            {selectedPacket.propType ? ` (${selectedPacket.propType})` : ''}.
          </p>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="input max-w-xs flex-1"
          placeholder="Search name, market, phone, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'active' | 'inactive' | '')}>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
          <option value="">All statuses</option>
        </select>
        <div className="ml-auto flex gap-1 rounded-lg border border-border-2 bg-surface-2 p-1">
          <button
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
              view === 'list' ? 'bg-surface text-text shadow-sm' : 'text-text-3 hover:text-text'
            }`}
            onClick={() => setView('list')}
          >
            <List size={14} /> List
          </button>
          <button
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
              view === 'map' ? 'bg-surface text-text shadow-sm' : 'text-text-3 hover:text-text'
            }`}
            onClick={() => setView('map')}
          >
            <MapPin size={14} /> Map
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-text-3">Loading buyers…</div>
      ) : isError ? (
        <div className="py-12 text-center text-sm text-danger">{(error as Error)?.message ?? 'Failed to load buyers.'}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-2 py-12 text-center text-sm text-text-3">
          {buyers.length === 0
            ? 'No cash buyers yet — add your first one to start building the roster.'
            : selectedPacket
              ? 'No active buyers match this deal’s buy box.'
              : 'No buyers match your search.'}
        </div>
      ) : view === 'map' ? (
        <Suspense fallback={<div className="py-12 text-center text-sm text-text-3">Loading map…</div>}>
          <BuyersMapView buyers={filtered} />
        </Suspense>
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
                      <span className="font-medium text-text">{b.name}</span>
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
                  <td className="px-3 py-2.5 text-text-2">{marketsLabel(b)}</td>
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
