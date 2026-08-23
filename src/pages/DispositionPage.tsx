import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Facebook, Handshake, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCashBuyers, useDeleteCashBuyer } from '@/hooks/useCashBuyers';
import { CashBuyerModal } from '@/components/disposition/CashBuyerModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { BUYER_PROPERTY_TYPE_LABELS, DEAL_TYPE_CONFIG, type CashBuyer } from '@/types/domain';
import { externalHref, formatCurrency, formatPhone } from '@/lib/utils';

const MAX_MARKET_ENTRIES = 3;

/** Cities/counties only — states render separately (see statesLabel) so the
 *  two never run together into one hard-to-parse line. */
function citiesLabel(buyer: CashBuyer): string {
  const entries = [...buyer.marketCounties.map((c) => `${c} County`), ...buyer.marketCities];
  if (entries.length === 0) return 'Any city';
  if (entries.length <= MAX_MARKET_ENTRIES) return entries.join(', ');
  return `${entries.slice(0, MAX_MARKET_ENTRIES).join(', ')} +${entries.length - MAX_MARKET_ENTRIES} more`;
}

function statesLabel(buyer: CashBuyer): string {
  return buyer.marketStates.length > 0 ? buyer.marketStates.join(', ') : 'Any state';
}

function priceRangeLabel(buyer: CashBuyer): string {
  if (buyer.priceMin == null && buyer.priceMax == null) return 'Any price';
  if (buyer.priceMin != null && buyer.priceMax != null) return `${formatCurrency(buyer.priceMin)} – ${formatCurrency(buyer.priceMax)}`;
  if (buyer.priceMin != null) return `${formatCurrency(buyer.priceMin)}+`;
  return `Up to ${formatCurrency(buyer.priceMax)}`;
}

function BuyerCard({ buyer, onEdit, onDelete }: { buyer: CashBuyer; onEdit: () => void; onDelete: () => void }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`/disposition/${buyer.id}`)}
      className="card card-hover !p-4 cursor-pointer transition-transform hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-semibold text-text">{buyer.name}</span>
          {buyer.facebookUrl && (
            <a
              href={externalHref(buyer.facebookUrl)}
              target="_blank"
              rel="noopener noreferrer"
              title="Open Facebook profile"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 text-[#1877F2] hover:opacity-70"
            >
              <Facebook size={14} />
            </a>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            buyer.status === 'active' ? 'bg-success-dim text-success' : 'bg-surface-3 text-text-3'
          }`}
        >
          {buyer.status === 'active' ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="mt-1 truncate text-[12px] text-text-3">
        {[buyer.phone ? formatPhone(buyer.phone) : null, buyer.email].filter(Boolean).join(' · ') || 'No contact info'}
      </div>

      <div className="mt-3 border-t border-border-2 pt-3 text-[12px]">
        <div className="text-text-2">{citiesLabel(buyer)}</div>
        <div className="mt-0.5 font-bold text-text">{statesLabel(buyer)}</div>
        <div className="mt-1.5 text-text-3">
          {buyer.propertyTypes.length > 0 ? buyer.propertyTypes.map((t) => BUYER_PROPERTY_TYPE_LABELS[t]).join(', ') : 'Any type'}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border-2 pt-3">
        <div>
          <div className="text-sm font-semibold text-text">{priceRangeLabel(buyer)}</div>
          <div className="text-[11px] text-text-3">
            {buyer.dealTypes.length > 0 ? buyer.dealTypes.map((t) => DEAL_TYPE_CONFIG[t].label).join(', ') : 'Any structure'}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            className="btn !p-1.5"
            title="Edit"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Pencil size={13} />
          </button>
          <button
            className="btn !p-1.5"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function DispositionPage() {
  const { data: buyers = [], isLoading, isError, error } = useCashBuyers();
  const deleteCashBuyer = useDeleteCashBuyer();

  const [nameSearch, setNameSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | ''>('active');
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<CashBuyer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CashBuyer | null>(null);

  const filtered = useMemo(() => {
    const q = nameSearch.trim().toLowerCase();
    return buyers.filter((b) => {
      if (statusFilter && b.status !== statusFilter) return false;
      if (q) {
        const haystack = `${b.name} ${b.marketStates.join(' ')} ${b.marketCounties.join(' ')} ${b.marketCities.join(' ')} ${b.phone ?? ''} ${b.email ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [buyers, nameSearch, statusFilter]);

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

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="input max-w-xs flex-1"
          placeholder="Search name, market, phone, email…"
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((b) => (
            <BuyerCard key={b.id} buyer={b} onEdit={() => setEditTarget(b)} onDelete={() => setDeleteTarget(b)} />
          ))}
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
