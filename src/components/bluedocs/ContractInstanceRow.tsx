import { useState } from 'react';
import { Check, Copy, Download, Eye, Trash2 } from 'lucide-react';
import type { ContractInstance } from '@/hooks/useContractInstances';
import { formatDate } from '@/lib/utils';

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
        <div className="mt-1 flex gap-1.5">
          {c.parties.map((p) => {
            const unlocked = !c.parties.some((other) => other.signOrder < p.signOrder && other.status !== 'signed');
            return (
              <span
                key={p.id}
                className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold capitalize ${p.status === 'signed' ? 'bg-success-dim text-success' : 'bg-surface-2 text-text-3'}`}
              >
                {p.role} {p.status === 'signed' ? '✓' : '· pending'}
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
