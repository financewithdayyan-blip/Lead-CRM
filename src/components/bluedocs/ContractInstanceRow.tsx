import { useMemo, useState } from 'react';
import { Ban, Check, CheckCircle2, Clock, Copy, Download, Eye, EyeOff, MapPin, Send, Trash2 } from 'lucide-react';
import { useContractAuditEvents, type ContractInstance } from '@/hooks/useContractInstances';
import { PURCHASE_CONTRACT_TYPES, roleLabel } from '@/hooks/useDocTemplates';
import { formatDate, formatDateTime } from '@/lib/utils';

const STATUS_BADGE: Record<ContractInstance['status'], { label: string; className: string; icon: typeof Send } | null> = {
  draft: null,
  sent: { label: 'Sent', className: 'bg-info-dim text-info', icon: Send },
  partial: { label: 'Partially signed', className: 'bg-warning-dim text-warning', icon: Clock },
  signed: { label: 'Completed', className: 'bg-success-dim text-success', icon: CheckCircle2 },
  declined: { label: 'Declined', className: 'bg-danger-dim text-danger', icon: Ban },
  voided: { label: 'Voided', className: 'bg-danger-dim text-danger', icon: Ban },
  expired: { label: 'Expired', className: 'bg-surface-2 text-text-3', icon: Clock },
};

/** Every generated instance is named after its template ("Letter Of Intent to
 * Purchase Real Estate"), which is identical across every deal — that name
 * alone can't tell two contracts for different properties apart. Prefers the
 * address collected at send time (SendContractModal); older instances sent
 * before that existed fall back to whatever field got mapped as the address,
 * once it's actually been filled in by a signer. */
function findAddress(instance: ContractInstance): string | null {
  if (instance.propertyAddress?.trim()) return instance.propertyAddress.trim();
  const field = instance.templateFields.find((f) => f.type !== 'signature' && /address/i.test(f.label));
  const value = field ? instance.fieldValues[field.id] : null;
  return value?.trim() || null;
}

/** Shared row rendering for a generated contract — used by both the global
 * Contracts tab and a single template's Sign Inbox. */
export function ContractInstanceRow({
  instance: c,
  showTemplateName = true,
  onPreview,
  onDownload,
  onDelete,
  onVoid,
}: {
  instance: ContractInstance;
  showTemplateName?: boolean;
  onPreview: () => void;
  onDownload: (path: string, name: string) => void;
  onDelete: () => void;
  /** Omitted entirely for a template's own Sign Inbox list, where voiding
   * isn't offered — only the global Envelopes dashboard passes this. */
  onVoid?: () => void;
}) {
  const [copiedPartyId, setCopiedPartyId] = useState<string | null>(null);
  const { data: events = [] } = useContractAuditEvents(c.id);
  const address = useMemo(() => findAddress(c), [c]);

  // Most recent "opened the link" moment per party, if any — lets an admin
  // tell "sent but never opened" apart from "opened, just hasn't signed yet."
  const lastViewedByParty = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of events) {
      if (e.eventType !== 'viewed' || !e.partyId) continue;
      const existing = map.get(e.partyId);
      if (!existing || e.createdAt > existing) map.set(e.partyId, e.createdAt);
    }
    return map;
  }, [events]);

  function copyPartyLink(id: string, token: string) {
    navigator.clipboard.writeText(`${window.location.origin}/crm/sign/${token}`);
    setCopiedPartyId(id);
    setTimeout(() => setCopiedPartyId(null), 1500);
  }

  const signed = c.status === 'signed';
  const voidedOrDeclined = c.status === 'voided' || c.status === 'declined';
  const canVoid = onVoid && !signed && !voidedOrDeclined && c.status !== 'expired';
  const badge = STATUS_BADGE[c.status];
  const BadgeIcon = badge?.icon;
  const typeLabel = PURCHASE_CONTRACT_TYPES.find((o) => o.key === c.templateContractType)?.label;

  return (
    <div
      className={`flex items-center justify-between rounded-lg border px-3.5 py-3 ${
        signed ? 'border-success/30 bg-success-dim' : voidedOrDeclined ? 'border-danger/30 bg-danger-dim' : 'border-border-2 bg-surface-3'
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-text">
          <span className="truncate">{c.name}</span>
          {typeLabel && (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{typeLabel}</span>
          )}
          {badge && BadgeIcon && (
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}>
              <BadgeIcon size={10} /> {badge.label}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-text-3">
          {showTemplateName && c.templateName ? `${c.templateName} · ` : ''}
          {formatDate(c.createdAt)}
        </div>
        {address && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-text-2" title={address}>
            <MapPin size={11} className="shrink-0 text-text-3" /> {address}
          </div>
        )}
        <div className="mt-1 flex gap-1.5">
          {c.parties.map((p) => {
            const unlocked = !c.parties.some((other) => other.signOrder < p.signOrder && other.status !== 'signed');
            const lastViewed = lastViewedByParty.get(p.id);
            return (
              <span
                key={p.id}
                className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${p.status === 'signed' ? 'bg-success-dim text-success' : 'bg-surface-2 text-text-3'}`}
              >
                {p.role === 'buyer' || p.role === 'seller'
                  ? `${roleLabel(p.role, c.templateType ?? 'contract')} · ${p.name}`
                  : p.name}{' '}
                {p.status === 'signed' ? '✓' : '· pending'}
                {p.status !== 'signed' && unlocked && (
                  <span title={lastViewed ? `Opened the link ${formatDateTime(lastViewed)}` : "Hasn't opened the link yet"}>
                    {lastViewed ? <Eye size={10} className="text-info" /> : <EyeOff size={10} className="text-text-3" />}
                  </span>
                )}
                {p.status !== 'signed' && unlocked && (
                  <button
                    className="ml-0.5 text-text-3 hover:text-text"
                    title="Copy their signing link"
                    onClick={() => copyPartyLink(p.id, p.accessToken)}
                  >
                    {copiedPartyId === p.id ? <Check size={10} /> : <Copy size={10} />}
                  </button>
                )}
              </span>
            );
          })}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button className="btn !px-2 !py-1 text-[11px]" onClick={onPreview}>
          <Eye size={12} /> Preview
        </button>
        {c.status === 'signed' && c.finalStoragePath && (
          <button className="btn !px-2 !py-1 text-[11px]" onClick={() => onDownload(c.finalStoragePath!, c.name)}>
            <Download size={12} /> Download signed PDF
          </button>
        )}
        {canVoid && (
          <button className="btn !px-2 !py-1 text-[11px]" title="Void — cancels the send, keeps the history" onClick={onVoid}>
            <Ban size={12} /> Void
          </button>
        )}
        <button className="btn !px-2 !py-1 text-[11px] text-danger" onClick={onDelete}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
