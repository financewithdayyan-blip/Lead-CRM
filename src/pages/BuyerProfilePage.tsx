import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  DollarSign,
  Facebook,
  Handshake,
  Home,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { useCashBuyers, useDeleteCashBuyer } from '@/hooks/useCashBuyers';
import { CashBuyerModal } from '@/components/disposition/CashBuyerModal';
import { BuyerSmsThread } from '@/components/disposition/BuyerSmsThread';
import { BuyerDealsSection } from '@/components/disposition/BuyerDealsSection';
import { CardHeader } from '@/components/ui/CardHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { BUYER_CONDITION_LABELS, BUYER_PROPERTY_TYPE_LABELS, DEAL_TYPE_CONFIG } from '@/types/domain';
import { externalHref, formatCurrency, formatDate, formatPhone } from '@/lib/utils';

const TABS = [
  ['overview', 'Overview', Building2],
  ['messages', 'Messages', MessageSquare],
  ['deals', 'Deals Bought', Home],
] as const;
type TabKey = (typeof TABS)[number][0];

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-surface-3 px-2.5 py-1 text-[12px] font-medium text-text-2">{children}</span>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{label}</div>
      <div className="mt-0.5 text-sm text-text">{value}</div>
    </div>
  );
}

export function BuyerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: buyers = [], isLoading } = useCashBuyers();
  const deleteCashBuyer = useDeleteCashBuyer();
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [tab, setTab] = useState<TabKey>('overview');

  const buyer = buyers.find((b) => b.id === id);

  if (isLoading) return <div className="text-text-3">Loading…</div>;
  if (!buyer) return <div className="text-text-3">Buyer not found.</div>;

  const priceRange =
    buyer.priceMin == null && buyer.priceMax == null
      ? 'Any price'
      : buyer.priceMin != null && buyer.priceMax != null
        ? `${formatCurrency(buyer.priceMin)} – ${formatCurrency(buyer.priceMax)}`
        : buyer.priceMin != null
          ? `${formatCurrency(buyer.priceMin)}+`
          : `Up to ${formatCurrency(buyer.priceMax)}`;

  return (
    <div>
      <button onClick={() => navigate('/disposition')} className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-text-3 hover:text-text">
        <ArrowLeft size={14} /> Back to Disposition
      </button>

      <div className="card mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-semibold text-text">{buyer.name}</h1>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  buyer.status === 'active' ? 'bg-success-dim text-success' : 'bg-surface-3 text-text-3'
                }`}
              >
                {buyer.status === 'active' ? 'Active' : 'Inactive'}
              </span>
              {buyer.facebookUrl && (
                <a
                  href={externalHref(buyer.facebookUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open Facebook profile"
                  className="flex items-center gap-1.5 rounded-full bg-[#1877F2] px-3 py-1 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-[#166FE5]"
                >
                  <Facebook size={14} /> Facebook
                </a>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-2">
              {buyer.phone && (
                <span className="flex items-center gap-1.5">
                  <Phone size={13} className="text-text-3" /> {formatPhone(buyer.phone)}
                </span>
              )}
              {buyer.email && (
                <span className="flex items-center gap-1.5">
                  <Mail size={13} className="text-text-3" /> {buyer.email}
                </span>
              )}
              {!buyer.phone && !buyer.email && <span className="text-text-3">No contact info on file</span>}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={() => setShowEdit(true)}>
              <Pencil size={13} /> Edit
            </button>
            <button className="btn btn-danger" onClick={() => setShowDelete(true)}>
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      </div>

      <div className="mb-5 flex gap-1 border-b border-border">
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors ${
              tab === key ? 'border-primary text-primary' : 'border-transparent text-text-3 hover:text-text'
            }`}
            onClick={() => setTab(key)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="card mb-5">
            <CardHeader icon={MapPin} title="Markets" tone="info" />
            <div className="mt-3 space-y-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">States</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {buyer.marketStates.length > 0 ? buyer.marketStates.map((s) => <Pill key={s}>{s}</Pill>) : <span className="text-sm text-text-3">Any state</span>}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Counties</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {buyer.marketCounties.length > 0 ? (
                    buyer.marketCounties.map((c) => <Pill key={c}>{c} County</Pill>)
                  ) : (
                    <span className="text-sm text-text-3">None on file</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Cities</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {buyer.marketCities.length > 0 ? buyer.marketCities.map((c) => <Pill key={c}>{c}</Pill>) : <span className="text-sm text-text-3">Any city</span>}
                </div>
              </div>
            </div>
          </div>

          <div className="card mb-5">
            <CardHeader icon={Building2} title="Buy Box" tone="accent" />
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field
                label="Property Types"
                value={buyer.propertyTypes.length > 0 ? buyer.propertyTypes.map((t) => BUYER_PROPERTY_TYPE_LABELS[t]).join(', ') : 'Any type'}
              />
              <Field
                label="Deal Structures"
                value={buyer.dealTypes.length > 0 ? buyer.dealTypes.map((t) => DEAL_TYPE_CONFIG[t].label).join(', ') : 'Any structure'}
              />
              <Field label="Condition" value={buyer.condition ? BUYER_CONDITION_LABELS[buyer.condition] : 'No preference / not asked yet'} />
              <Field label="Min Beds" value={buyer.minBeds ?? 'No minimum'} />
              <Field label="Min Baths" value={buyer.minBaths ?? 'No minimum'} />
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-lg font-semibold text-text">
              <DollarSign size={18} className="text-success" />
              {priceRange}
            </div>
          </div>

          {buyer.notes && (
            <div className="card mb-5">
              <CardHeader icon={StickyNote} title="Notes" tone="warning" />
              <p className="mt-3 whitespace-pre-wrap text-sm text-text-2">{buyer.notes}</p>
            </div>
          )}

          <div className="flex items-center gap-1.5 text-[12px] text-text-3">
            <Handshake size={13} />
            Added {formatDate(buyer.createdAt)}
            {buyer.updatedAt !== buyer.createdAt ? ` · Updated ${formatDate(buyer.updatedAt)}` : ''}
          </div>
        </>
      )}

      {tab === 'messages' && <BuyerSmsThread buyer={buyer} />}

      {tab === 'deals' && <BuyerDealsSection buyerId={buyer.id} />}

      {showEdit && <CashBuyerModal buyer={buyer} onClose={() => setShowEdit(false)} />}
      <ConfirmDialog
        open={showDelete}
        title="Delete buyer?"
        message={`Remove ${buyer.name} from the roster? This can't be undone.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setShowDelete(false)}
        onConfirm={() => {
          deleteCashBuyer.mutate(buyer.id);
          navigate('/disposition');
        }}
      />
    </div>
  );
}
