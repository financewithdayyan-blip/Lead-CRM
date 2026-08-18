import { useMemo, useState } from 'react';
import { Ban, Bell, Check, CheckCircle2, ChevronDown, Clock, Copy, Download, Eye, Handshake, Loader2, MapPin, Send, Sparkles, Trash2 } from 'lucide-react';
import { useContractAuditEvents, useSendContractReminder, type ContractInstance } from '@/hooks/useContractInstances';
import { PURCHASE_CONTRACT_TYPES, roleLabel } from '@/hooks/useDocTemplates';
import { formatDateTime, formatPhone } from '@/lib/utils';

const STATUS_BADGE: Record<ContractInstance['status'], { label: string; className: string; icon: typeof Send } | null> = {
  draft: null,
  sent: { label: 'Sent', className: 'bg-info-dim text-info', icon: Send },
  partial: { label: 'Partially signed', className: 'bg-warning-dim text-warning', icon: Clock },
  signed: { label: 'Completed', className: 'bg-success-dim text-success', icon: CheckCircle2 },
  declined: { label: 'Declined', className: 'bg-danger-dim text-danger', icon: Ban },
  voided: { label: 'Voided', className: 'bg-danger-dim text-danger', icon: Ban },
  expired: { label: 'Expired', className: 'bg-surface-2 text-text-3', icon: Clock },
};

/** One color language per step-in-the-signing-chain state, drawn from the
 * app's own brand tokens (not arbitrary Tailwind hues) so this reads as part
 * of the same CRM instead of a bolted-on component. "Signed" uses the same
 * brass/accent tone as the deal-closed ribbon — one gold thread running from
 * the moment a party signs through to the closing banner, rather than
 * switching to an unrelated green. */
const PARTY_STEP_STYLE: Record<
  'signed' | 'viewed' | 'sent' | 'waiting' | 'declined',
  { badge: string; card: string; pill: string; label: string }
> = {
  signed: { badge: 'bg-accent text-[#0B1E33]', card: 'border-accent/25 bg-accent-dim', pill: 'bg-accent/20 text-accent-hover', label: 'Signed' },
  viewed: { badge: 'bg-primary text-white', card: 'border-border-2 bg-surface', pill: 'bg-primary-dim text-primary-text', label: 'Viewed' },
  sent: { badge: 'bg-info text-white', card: 'border-border-2 bg-surface', pill: 'bg-info-dim text-info-text', label: 'Sent' },
  waiting: { badge: 'bg-surface-3 text-text-3 ring-1 ring-inset ring-border-2', card: 'border-border-2 bg-surface', pill: 'bg-surface-3 text-text-3', label: 'Waiting' },
  declined: { badge: 'bg-danger text-white', card: 'border-danger/25 bg-danger-dim', pill: 'bg-danger-dim text-danger', label: 'Declined' },
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
  const [reminded, setReminded] = useState(false);
  const [showParties, setShowParties] = useState(false);
  const { data: events = [] } = useContractAuditEvents(c.id);
  const sendReminder = useSendContractReminder();
  const address = useMemo(() => findAddress(c), [c]);

  const orderedParties = useMemo(() => [...c.parties].sort((a, b) => a.signOrder - b.signOrder), [c.parties]);

  // The one party who can actually act right now — signing is strictly
  // sequential, so at most one party is ever both pending and unlocked.
  const pendingParty = useMemo(
    () =>
      c.parties.find(
        (p) => p.status === 'pending' && !c.parties.some((other) => other.signOrder < p.signOrder && other.status !== 'signed'),
      ),
    [c.parties],
  );

  function handleRemind() {
    if (!pendingParty) return;
    sendReminder.mutate(pendingParty.id, {
      onSuccess: () => {
        setReminded(true);
        setTimeout(() => setReminded(false), 2000);
      },
    });
  }

  // Earliest "invite texted" and most recent "opened the link" moment per
  // party, from the audit trail — lets each step show a real timestamp
  // instead of just a static label.
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
      className={`overflow-hidden rounded-xl border bg-surface shadow-card ${
        signed ? 'border-success/25' : voidedOrDeclined ? 'border-danger/25' : 'border-border-2'
      }`}
    >
      <div className={`h-[3px] w-full ${signed ? 'bg-success' : voidedOrDeclined ? 'bg-danger' : 'bg-border-2'}`} />
      <div className="p-3.5">
      <div className="flex items-start justify-between gap-3">
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
            {formatDateTime(c.createdAt)}
          </div>
          {address && (
            <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-text-2" title={address}>
              <MapPin size={11} className="shrink-0 text-text-3" /> {address}
            </div>
          )}
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
          {pendingParty && (
            <button
              className="btn !px-2 !py-1 text-[11px]"
              title={`Text ${pendingParty.name} a friendly reminder to sign`}
              disabled={sendReminder.isPending}
              onClick={handleRemind}
            >
              {sendReminder.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : reminded ? (
                <Check size={12} />
              ) : (
                <Bell size={12} />
              )}
              {reminded ? 'Sent' : 'Send Reminder'}
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

      {signed && (
        <div className="relative mt-3 overflow-hidden rounded-xl border border-white/5 bg-gradient-to-br from-[#0B1E33] via-[#0f2745] to-[#0B1E33] p-4">
          <div className="relative">
            {/* Ribbon shape lives in its own SVG layer, purely decorative —
               the text row below is never clipped by its geometry. */}
            <svg
              className="pointer-events-none absolute inset-y-0 left-6 right-6 my-auto h-8 w-[calc(100%-3rem)]"
              viewBox="0 0 400 40"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="dealRibbonGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#b3893a" />
                  <stop offset="50%" stopColor="#e6c988" />
                  <stop offset="100%" stopColor="#b3893a" />
                </linearGradient>
              </defs>
              <polygon points="0,20 20,2 380,2 400,20 380,38 20,38" fill="url(#dealRibbonGrad)" />
            </svg>

            <div className="relative flex h-8 items-center gap-2 pl-12 pr-8 text-[12.5px] font-semibold tracking-wide text-[#0B1E33]">
              <Handshake size={13} className="shrink-0" />
              <span>Deal closed — contract fully signed</span>
            </div>

            <Sparkles size={10} className="pointer-events-none absolute right-10 -top-1 text-white/50" />

            <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#0B1E33] shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-accent/80 bg-gradient-to-br from-[#eccf94] to-accent">
                <Handshake size={15} className="text-[#0B1E33]" />
              </div>
            </div>
          </div>
        </div>
      )}

      <button
        className="mt-3 flex w-full items-center justify-between rounded-lg border border-border-2 bg-surface-2 px-3 py-2 text-[12px] font-medium text-text-2 transition-colors hover:bg-surface-3"
        onClick={() => setShowParties((v) => !v)}
      >
        <span>See signees ({orderedParties.length})</span>
        <ChevronDown size={14} className={`transition-transform ${showParties ? 'rotate-180' : ''}`} />
      </button>

      {showParties && (
      <div className="mt-3 space-y-0">
        {orderedParties.map((p, i) => {
          const unlocked = !orderedParties.some((other) => other.signOrder < p.signOrder && other.status !== 'signed');
          const viewedAt = viewedAtByParty.get(p.id);
          const sentAt = sentAtByParty.get(p.id);

          const stepKey: keyof typeof PARTY_STEP_STYLE =
            p.status === 'declined' ? 'declined' : p.status === 'signed' ? 'signed' : !unlocked ? 'waiting' : viewedAt ? 'viewed' : 'sent';
          const style = PARTY_STEP_STYLE[stepKey];
          const at = p.status === 'declined' ? p.declinedAt : p.status === 'signed' ? p.signedAt : viewedAt ? viewedAt : sentAt;
          // Only the party who's actually unlocked and still pending has a
          // live link worth copying — equivalent to stepKey being 'sent' or
          // 'viewed', spelled out directly instead of re-checking stepKey.
          const canCopyLink = unlocked && p.status === 'pending';
          const displayName = p.role === 'buyer' || p.role === 'seller' ? `${roleLabel(p.role, c.templateType ?? 'contract')} · ${p.name}` : p.name;
          const isLast = i === orderedParties.length - 1;

          return (
            <div key={p.id} className="flex items-stretch gap-2.5">
              <div className="flex flex-col items-center">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${style.badge}`}>
                  {i + 1}
                </span>
                {!isLast && <span className="my-1 w-px flex-1 bg-border-2" />}
              </div>
              <div className={`mb-2 flex-1 min-w-0 rounded-lg border px-3 py-2 ${style.card}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-text">{displayName}</div>
                    {p.phone && <div className="truncate text-[11px] text-text-3">{formatPhone(p.phone)}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.pill}`}>{style.label}</span>
                    {canCopyLink && (
                      <button
                        className="text-text-3 hover:text-text"
                        title="Copy their signing link"
                        onClick={() => copyPartyLink(p.id, p.accessToken)}
                      >
                        {copiedPartyId === p.id ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    )}
                  </div>
                </div>
                {at && <div className="mt-1 text-[10px] text-text-3">{formatDateTime(at)}</div>}
              </div>
            </div>
          );
        })}
      </div>
      )}
      </div>
    </div>
  );
}
