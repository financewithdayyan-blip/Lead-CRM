import { useEffect, useRef } from 'react';
import { renderPdfPageToCanvas, type pdfjsLib } from '@/lib/pdfjs';
import type { ContractField, ContractFieldRole } from '@/hooks/useDocTemplates';

export const ROLE_COLOR: Record<ContractFieldRole, string> = {
  buyer: '#0ea5e9',
  seller: '#a78bfa',
};

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
  editableValues,
  onEditableChange,
}: {
  pdf: pdfjsLib.PDFDocumentProxy;
  pageNum: number;
  pageWidth: number;
  fields: ContractField[];
  fieldValues: Record<string, string>;
  signatures: Array<{ role: ContractFieldRole; signatureDataUrl: string }>;
  activeRole?: ContractFieldRole;
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
        if (f.type === 'date') return null;

        if (f.type === 'text' || f.type === 'full_name' || f.type === 'currency') {
          const value = fieldValues[f.id];
          const isMine = f.role === activeRole;

          if (!value && isMine && editableValues && onEditableChange) {
            return (
              <div key={f.id} className="absolute" style={{ left: `${f.xPct}%`, top: `${f.yPct}%`, width: `${f.wPct}%`, height: `${f.hPct}%` }}>
                {f.type === 'currency' && (
                  <span className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-[11px] text-slate-500">$</span>
                )}
                <input
                  className={`h-full w-full rounded-sm border-2 border-dashed bg-white/95 text-[11px] text-slate-800 outline-none ${f.type === 'currency' ? 'pl-3.5' : 'px-1'}`}
                  style={{ borderColor: ROLE_COLOR[f.role] }}
                  placeholder={f.label}
                  inputMode={f.type === 'currency' ? 'decimal' : undefined}
                  value={editableValues[f.id] ?? ''}
                  onChange={(e) => onEditableChange(f.id, e.target.value)}
                />
              </div>
            );
          }

          if (!value) return null;
          return (
            <div
              key={f.id}
              className="absolute flex items-center overflow-hidden truncate text-[11px] text-slate-800"
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
            style={{ left: `${f.xPct}%`, top: `${f.yPct}%`, width: `${f.wPct}%`, height: `${f.hPct}%`, borderColor: ROLE_COLOR[f.role] }}
          >
            <span className="pointer-events-none px-1 text-[9px] font-semibold capitalize" style={{ color: ROLE_COLOR[f.role] }}>
              {isMine ? 'Sign below ↓' : `${f.role} — not yet signed`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
