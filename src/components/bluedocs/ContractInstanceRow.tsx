import { useMemo, useState } from 'react';
import { Check, Copy, Download, Eye, EyeOff, MapPin, Trash2 } from 'lucide-react';
import { useContractAuditEvents, type ContractInstance } from '@/hooks/useContractInstances';
import { roleLabel } from '@/hooks/useDocTemplates';
import { formatDate, formatDateTime } from '@/lib/utils';

/** Every generated instance is named after its template ("Letter Of Intent to
 * Purchase Real Estate"), which is identical across every deal — with no lead
 * required to generate one anymore, that name alone can't tell two LOIs for
 * different properties apart. Whatever field got mapped as the property
 * address is the next best thing, once it's actually been filled in. */
function findAddress(instance: ContractInstance): string | null {
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
}: {
  instance: ContractInstance;
  showTemplateName?: boolean;
  onPreview: () => void;
  onDownload: (path: string, name: string) => void;
  onDelete: () => void;
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

  return (
    <div className="flex items-center justify-between rounded-md border border-border-2 bg-surface-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-text">{c.name}</div>
        <div className="truncate text-[11px] text-text-3">
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
                {p.role === 'buyer' || p.role === 'seller' ? roleLabel(p.role, c.templateType ?? 'contract') : p.name}{' '}
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
        <button className="btn !px-2 !py-1 text-[11px] text-danger" onClick={onDelete}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
