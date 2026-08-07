import { useEffect, useRef } from 'react';
import { renderPdfPageToCanvas, type pdfjsLib } from '@/lib/pdfjs';
import { roleLabel, roleColor, type ContractField, type PartyRole, type PartyRoleDef } from '@/hooks/useDocTemplates';

/**
 * Renders one page of a contract with every mapped field overlaid — filled
 * text as plain values, a signature image wherever that role has actually
 * signed, and a dashed placeholder otherwise. Shared by the signer's own
 * page (activeRole = whoever is currently signing, so their own pending
 * field reads "Sign below") and the admin's read-only preview (no
 * activeRole — every unsigned field just shows whose signature is missing).
 */
export function ContractDocumentPage({
  pdf,
  pageNum,
  pageWidth,
  fields,
  fieldValues,
  signatures,
  activeRole,
  docType = 'contract',
  partyRoles = [],
  editableValues,
  onEditableChange,
}: {
  pdf: pdfjsLib.PDFDocumentProxy;
  pageNum: number;
  pageWidth: number;
  fields: ContractField[];
  fieldValues: Record<string, string>;
  signatures: Array<{ role: PartyRole; signatureDataUrl: string }>;
  activeRole?: PartyRole;
  /** Only changes wording ("Us" vs "Buyer") — the underlying role stored on
   * each field is the same either way. */
  docType?: 'loi' | 'contract';
  /** The template's own extra signee roles, so a custom role id (e.g.
   * "extra_1") renders as its real label ("Witness") instead of a fallback. */
  partyRoles?: PartyRoleDef[];
  /** When provided (the signer's own page only), a field belonging to
   * activeRole with no saved value yet renders as a live input instead of
   * staying blank — this is how the buyer/seller actually fill in their own
   * fields, positioned right on the document where that field was mapped. */
  editableValues?: Record<string, string>;
  onEditableChange?: (fieldId: string, value: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    renderPdfPageToCanvas(pdf, pageNum, pageWidth).then(({ canvas }) => {
      if (cancelled || !containerRef.current) return;
      containerRef.current.querySelectorAll('canvas').forEach((c) => c.remove());
      containerRef.current.insertBefore(canvas, containerRef.current.firstChild);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNum, pageWidth]);

  const pageFields = fields.filter((f) => f.page === pageNum);

  return (
    <div
      ref={containerRef}
      className="relative mb-4 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
      style={{ width: pageWidth }}
    >
      {pageFields.map((f) => {
        if (f.type === 'text' || f.type === 'full_name' || f.type === 'currency' || f.type === 'date' || f.type === 'paragraph') {
          const value = fieldValues[f.id];
          const isMine = f.role === activeRole;
          const isParagraph = f.type === 'paragraph';

          if (!value && isMine && editableValues && onEditableChange) {
            return (
              <div key={f.id} className="absolute" style={{ left: `${f.xPct}%`, top: `${f.yPct}%`, width: `${f.wPct}%`, height: `${f.hPct}%` }}>
                {f.type === 'currency' && (
                  <span className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-[11px] text-slate-500">$</span>
                )}
                {isParagraph ? (
                  <textarea
                    className="h-full w-full resize-none rounded-sm border-2 border-dashed bg-white/95 p-1 text-[11px] leading-snug text-slate-800 outline-none"
                    style={{ borderColor: roleColor(f.role) }}
                    placeholder={f.label}
                    value={editableValues[f.id] ?? ''}
                    onChange={(e) => onEditableChange(f.id, e.target.value)}
                  />
                ) : (
                  <input
                    type={f.type === 'date' ? 'date' : 'text'}
                    className={`h-full w-full rounded-sm border-2 border-dashed bg-white/95 text-[11px] text-slate-800 outline-none ${f.type === 'currency' ? 'pl-3.5' : 'px-1'}`}
                    style={{ borderColor: roleColor(f.role) }}
                    placeholder={f.label}
                    inputMode={f.type === 'currency' ? 'decimal' : undefined}
                    value={editableValues[f.id] ?? ''}
                    onChange={(e) => onEditableChange(f.id, e.target.value)}
                  />
                )}
              </div>
            );
          }

          if (!value) return null;
          return (
            <div
              key={f.id}
              className={
                isParagraph
                  ? 'absolute overflow-y-auto whitespace-pre-wrap text-[10.5px] leading-snug text-slate-800'
                  : 'absolute flex items-center overflow-hidden truncate text-[11px] text-slate-800'
              }
              style={{ left: `${f.xPct}%`, top: `${f.yPct}%`, width: `${f.wPct}%`, height: `${f.hPct}%` }}
            >
              {value}
            </div>
          );
        }

        if (f.type !== 'signature') return null;

        const sig = signatures.find((s) => s.role === f.role);
        if (sig) {
          return (
            <img
              key={f.id}
              src={sig.signatureDataUrl}
              alt=""
              className="absolute object-contain"
              style={{ left: `${f.xPct}%`, top: `${f.yPct}%`, width: `${f.wPct}%`, height: `${f.hPct}%` }}
            />
          );
        }

        const isMine = f.role === activeRole;
        return (
          <div
            key={f.id}
            className="absolute rounded-sm border-2 border-dashed"
            style={{ left: `${f.xPct}%`, top: `${f.yPct}%`, width: `${f.wPct}%`, height: `${f.hPct}%`, borderColor: roleColor(f.role) }}
          >
            <span className="pointer-events-none px-1 text-[9px] font-semibold" style={{ color: roleColor(f.role) }}>
              {isMine ? 'Sign below ↓' : `${roleLabel(f.role, docType, partyRoles)} — not yet signed`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
