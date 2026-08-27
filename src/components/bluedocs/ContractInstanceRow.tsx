import { useMemo, useState } from 'react';
import { Ban, Bell, Check, CheckCircle2, ChevronDown, Clock, Copy, Download, Eye, Loader2, MapPin, PartyPopper, Send, Trash2 } from 'lucide-react';
import { useContractAuditEvents, useSendContractReminder, type ContractInstance } from '@/hooks/useContractInstances';
import { PURCHASE_CONTRACT_TYPES, roleLabel } from '@/hooks/useDocTemplates';
import { CASH_DEAL_ADDRESS_FIELD_ID, CASH_DEAL_TEMPLATE_ID } from '@/components/bluedocs/FillCashDealContractModal';
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

/** One color language per step-in-the-signing-chain state — deliberately its
 * own palette (not this app's success/warning/danger tokens), since these
 * describe a party's position in a sequential flow, not a pass/fail outcome.
 * `card` stays a fixed light pastel regardless of app theme (same idea as
 * the "Deal closed" banner below), so `text`/`subtext` are fixed dark colors
 * too, not the theme-aware text-text/text-text-3 tokens — those flip to
 * near-white in dark mode, which is illegible against a background that
 * never does. `declined` is the one exception: bg-danger-dim IS a theme
 * token that correctly darkens, so text-text/text-text-3 stay correct there. */
const PARTY_STEP_STYLE: Record<
  'signed' | 'viewed' | 'sent' | 'waiting' | 'declined',
  { badge: string; card: string; pill: string; label: string; text: string; subtext: string }
> = {
  signed: { badge: 'bg-amber-400 text-white', card: 'border-amber-200 bg-amber-50', pill: 'bg-amber-100 text-amber-700', label: 'Signed', text: 'text-amber-900', subtext: 'text-amber-700/80' },
  viewed: { badge: 'bg-cyan-500 text-white', card: 'border-cyan-200 bg-cyan-50', pill: 'bg-cyan-100 text-cyan-700', label: 'Viewed', text: 'text-cyan-900', subtext: 'text-cyan-700/80' },
  sent: { badge: 'bg-blue-500 text-white', card: 'border-blue-200 bg-blue-50', pill: 'bg-blue-100 text-blue-700', label: 'Sent', text: 'text-blue-900', subtext: 'text-blue-700/80' },
  waiting: { badge: 'bg-violet-300 text-white', card: 'border-violet-200 bg-violet-50', pill: 'bg-violet-100 text-violet-700', label: 'Waiting', text: 'text-violet-900', subtext: 'text-violet-700/80' },
  declined: { badge: 'bg-danger text-white', card: 'border-danger/25 bg-danger-dim', pill: 'bg-danger-dim text-danger', label: 'Declined', text: 'text-text', subtext: 'text-text-3' },
};

/** Every generated instance is named after its template ("Letter Of Intent to
 * Purchase Real Estate"), which is identical across every deal — that name
 * alone can't tell two contracts for different properties apart. Prefers the
 * address collected at send time (SendContractModal); older instances sent
 * before that existed fall back to whatever field got mapped as the address,
 * once it's actually been filled in by a signer. */
function findAddress(instance: ContractInstance): string | null {
  if (instance.propertyAddress?.trim()) return instance.propertyAddress.trim();
  // Known-by-ID fallback for Cash Deal specifically — field IDs are stable,
  // but a contract's own template_fields_snapshot freezes whatever label
  // that field had at creation time, so a contract sent before this
  // template's fields got readable labels can never match the label-text
  // search below even though its real address is right in fieldValues.
  if (instance.templateId === CASH_DEAL_TEMPLATE_ID) {
    const byId = instance.fieldValues[CASH_DEAL_ADDRESS_FIELD_ID]?.trim();
    if (byId) return byId;
  }
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
      className={`rounded-lg border p-3.5 ${
        signed ? 'border-success/30 bg-success-dim' : voidedOrDeclined ? 'border-danger/30 bg-danger-dim' : 'border-border-2 bg-surface-3'
      }`}
    >
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
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300/70 bg-gradient-to-r from-amber-100 via-yellow-50 to-amber-100 px-3 py-2 text-[12px] font-semibold text-amber-800 shadow-sm">
          <PartyPopper size={15} className="shrink-0 text-amber-600" />
          Deal closed — contract fully signed. Congrats! 🎉
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
                    <div className={`truncate text-[13px] font-semibold ${style.text}`}>{displayName}</div>
                    {p.phone && <div className={`truncate text-[11px] ${style.subtext}`}>{formatPhone(p.phone)}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.pill}`}>{style.label}</span>
                    {canCopyLink && (
                      <button
                        className="text-slate-500 hover:text-slate-800"
                        title="Copy their signing link"
                        onClick={() => copyPartyLink(p.id, p.accessToken)}
                      >
                        {copiedPartyId === p.id ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    )}
                  </div>
                </div>
                {at && <div className={`mt-1 text-[10px] ${style.subtext}`}>{formatDateTime(at)}</div>}
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
