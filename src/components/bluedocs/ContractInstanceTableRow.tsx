import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Bell, Check, ChevronDown, Download, Eye, Loader2, Pencil, Send, Trash2, type LucideIcon } from 'lucide-react';
import { useContractAuditEvents, useSendContractReminder, type ContractInstance } from '@/hooks/useContractInstances';
import { CASH_DEAL_ADDRESS_FIELD_ID, CASH_DEAL_TEMPLATE_ID } from '@/components/bluedocs/FillCashDealContractModal';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { formatDate, formatDateTime } from '@/lib/utils';

const AVATAR_PALETTE = [
  { bg: 'rgba(255,181,71,.15)', text: '#FFC46B' },
  { bg: 'rgba(110,123,255,.18)', text: '#A9B1FF' },
  { bg: 'rgba(61,214,181,.14)', text: '#4FE0BF' },
  { bg: 'rgba(90,184,255,.14)', text: '#7CC6FF' },
  { bg: 'rgba(180,140,255,.15)', text: '#C7A8FF' },
  { bg: 'rgba(255,107,107,.13)', text: '#FF8A8A' },
];
function avatarColorFor(id: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
function initialsOf(name: string): string {
  return name.split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}
function daysAgoLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Same address-recovery logic as the old card row — prefers the address
 * collected at send time, falls back to whatever field got mapped as the
 * address once a signer's filled it in. */
function findAddress(instance: ContractInstance): string | null {
  if (instance.propertyAddress?.trim()) return instance.propertyAddress.trim();
  if (instance.templateId === CASH_DEAL_TEMPLATE_ID) {
    const byId = instance.fieldValues[CASH_DEAL_ADDRESS_FIELD_ID]?.trim();
    if (byId) return byId;
  }
  const field = instance.templateFields.find((f) => f.type !== 'signature' && /address/i.test(f.label));
  const value = field ? instance.fieldValues[field.id] : null;
  return value?.trim() || null;
}

function MoreActionsMenu({
  onPreview,
  onEdit,
  onVoid,
  onDelete,
}: {
  onPreview: () => void;
  onEdit?: () => void;
  onVoid?: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text"
          onClick={onClick}
        >
          <ChevronDown size={14} />
        </button>
      )}
    >
      {(close) => (
        <>
          <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text hover:bg-surface-3" onClick={() => { close(); onPreview(); }}>
            <Eye size={12} /> Preview
          </button>
          {onEdit && (
            <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text hover:bg-surface-3" onClick={() => { close(); onEdit(); }}>
              <Pencil size={12} /> Edit terms
            </button>
          )}
          {onVoid && (
            <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text hover:bg-surface-3" onClick={() => { close(); onVoid(); }}>
              <Ban size={12} /> Void
            </button>
          )}
          <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-danger hover:bg-surface-3" onClick={() => { close(); onDelete(); }}>
            <Trash2 size={12} /> Delete
          </button>
        </>
      )}
    </DropdownMenu>
  );
}

/** One row in the Sent documents table — a compact at-a-glance summary
 * (who's next, how many of how many have signed, when) with the full
 * per-party audit timeline still one click away via Preview, rather than
 * repeating it inline the way the old card view did. */
export function ContractInstanceTableRow({
  instance: c,
  onPreview,
  onDownload,
  onDelete,
  onVoid,
  onEdit,
}: {
  instance: ContractInstance;
  onPreview: () => void;
  onDownload: (path: string, name: string) => void;
  onDelete: () => void;
  onVoid?: () => void;
  onEdit?: () => void;
}) {
  const [reminded, setReminded] = useState(false);
  const { data: events = [] } = useContractAuditEvents(c.id);
  const sendReminder = useSendContractReminder();
  const address = useMemo(() => findAddress(c), [c]);

  const orderedParties = useMemo(() => [...c.parties].sort((a, b) => a.signOrder - b.signOrder), [c.parties]);
  const pendingParty = useMemo(
    () => c.parties.find((p) => p.status === 'pending' && !c.parties.some((other) => other.signOrder < p.signOrder && other.status !== 'signed')),
    [c.parties],
  );

  const { sentAtByParty, viewedAtByParty } = useMemo(() => {
    const sentMap = new Map<string, string>();
    const viewedMap = new Map<string, string>();
    for (const e of events) {
      if (!e.partyId) continue;
      if (e.eventType === 'sent') {
        const existing = sentMap.get(e.partyId);
        if (!existing || e.createdAt < existing) sentMap.set(e.partyId, e.createdAt);
      }
      if (e.eventType === 'viewed') {
        const existing = viewedMap.get(e.partyId);
        if (!existing || e.createdAt > existing) viewedMap.set(e.partyId, e.createdAt);
      }
    }
    return { sentAtByParty: sentMap, viewedAtByParty: viewedMap };
  }, [events]);

  const isSellerSide = (role: string) => role === 'seller' || role.startsWith('seller_');
  const signedCount = c.parties.filter((p) => p.status === 'signed').length;
  const totalParties = c.parties.length;

  const signed = c.status === 'signed';
  const voidedOrDeclined = c.status === 'voided' || c.status === 'declined';
  const canVoid = !!onVoid && !signed && !voidedOrDeclined && c.status !== 'expired';
  const canEdit = !!onEdit && c.templateId === CASH_DEAL_TEMPLATE_ID && c.status === 'sent' && !c.parties.some((p) => isSellerSide(p.role) && p.status === 'signed');

  let statusText: string;
  let statusClass: string;
  if (c.status === 'signed') {
    statusText = c.completedAt ? `Signed ${formatDate(c.completedAt)}` : 'Signed';
    statusClass = 'bg-success-dim text-success';
  } else if (c.status === 'voided') {
    statusText = c.voidedAt ? `Voided ${formatDate(c.voidedAt)}` : 'Voided';
    statusClass = 'bg-danger-dim text-danger';
  } else if (c.status === 'declined') {
    const decl = c.parties.find((p) => p.status === 'declined');
    statusText = decl?.declinedAt ? `Declined ${formatDate(decl.declinedAt)}` : 'Declined';
    statusClass = 'bg-danger-dim text-danger';
  } else if (c.status === 'expired') {
    statusText = 'Expired';
    statusClass = 'bg-surface-2 text-text-3';
  } else if (pendingParty) {
    const viewedAt = viewedAtByParty.get(pendingParty.id);
    const sentAt = sentAtByParty.get(pendingParty.id) ?? c.createdAt;
    if (!isSellerSide(pendingParty.role)) {
      statusText = 'Your signature next';
      statusClass = 'bg-warning-dim text-warning';
    } else if (viewedAt) {
      statusText = `Opened ${daysAgoLabel(viewedAt)} ago`;
      statusClass = 'bg-info-dim text-info';
    } else {
      statusText = `Not opened, ${daysAgoLabel(sentAt)}`;
      statusClass = 'bg-danger-dim text-danger';
    }
  } else {
    statusText = 'Sent';
    statusClass = 'bg-info-dim text-info';
  }

  let primary: { label: string; icon: LucideIcon; onClick: () => void; highlight?: boolean; busy?: boolean } | null = null;
  if (signed && c.finalStoragePath) {
    primary = { label: 'Download', icon: Download, onClick: () => onDownload(c.finalStoragePath!, c.name) };
  } else if (pendingParty && !isSellerSide(pendingParty.role)) {
    primary = {
      label: 'Sign now',
      icon: Send,
      highlight: true,
      onClick: () => window.open(`${window.location.origin}/crm/sign/${pendingParty.accessToken}`, '_blank'),
    };
  } else if (pendingParty) {
    primary = {
      label: reminded ? 'Sent' : 'Remind',
      icon: reminded ? Check : Bell,
      busy: sendReminder.isPending,
      onClick: () =>
        sendReminder.mutate(pendingParty.id, {
          onSuccess: () => {
            setReminded(true);
            setTimeout(() => setReminded(false), 2000);
          },
        }),
    };
  }

  return (
    <tr className="border-b border-border-2 last:border-0 hover:bg-surface-3">
      <td className="px-3 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[10px] font-extrabold text-primary">
            {c.templateType === 'loi' ? 'LOI' : 'PDF'}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-text">{c.name}</div>
            {address ? (
              c.leadId ? (
                <Link to={`/leads/${c.leadId}`} className="block truncate text-[11.5px] font-medium text-text-3 hover:text-primary">{address}</Link>
              ) : (
                <div className="truncate text-[11.5px] text-text-3">{address}</div>
              )
            ) : (
              <div className="truncate text-[11.5px] text-text-3">{formatDateTime(c.createdAt)}</div>
            )}
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        {orderedParties.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            {orderedParties.map((p) => {
              const avatar = avatarColorFor(p.id);
              return (
                <div key={p.id} className="flex min-w-0 items-center gap-2">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ background: avatar.bg, color: avatar.text }}
                  >
                    {initialsOf(p.name)}
                  </span>
                  <span className="truncate text-[12.5px] text-text-2">{p.name}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <span className="text-text-3">—</span>
        )}
      </td>
      <td className="px-3 py-3 text-text-2">{formatDate(c.createdAt)}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-primary" style={{ width: totalParties ? `${(signedCount / totalParties) * 100}%` : '0%' }} />
          </div>
          <span className="shrink-0 font-mono text-[11.5px] text-text-3">{signedCount} of {totalParties}</span>
        </div>
      </td>
      <td className="px-3 py-3">
        <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass}`}>{statusText}</span>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-1.5">
          {primary && (
            <button
              className={`btn !px-2.5 !py-1.5 text-[11.5px] ${primary.highlight ? 'btn-primary' : ''}`}
              disabled={primary.busy}
              onClick={primary.onClick}
            >
              {primary.busy ? <Loader2 size={12} className="animate-spin" /> : <primary.icon size={12} />}
              {primary.label}
            </button>
          )}
          <MoreActionsMenu onPreview={onPreview} onEdit={canEdit ? onEdit : undefined} onVoid={canVoid ? onVoid : undefined} onDelete={onDelete} />
        </div>
      </td>
    </tr>
  );
}
