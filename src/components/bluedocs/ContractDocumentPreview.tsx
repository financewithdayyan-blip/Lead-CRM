import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { renderPdfPageToCanvas, type pdfjsLib } from '@/lib/pdfjs';
import { roleLabel, roleColor, type ContractField, type PartyRole, type PartyRoleDef } from '@/hooks/useDocTemplates';

/**
 * Renders one page of a contract with every mapped field overlaid — filled
 * text as plain values, a checkmark wherever a tickmark field was checked, a
 * signature image wherever that specific box has actually been signed, and a
 * dashed placeholder otherwise. Shared by the signer's own page (activeRole =
 * whoever is currently signing, so their own pending fields are clickable/
 * editable) and the admin's read-only preview (no activeRole — every unsigned
 * field just shows whose signature is missing).
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
  signatureReady,
  onSignField,
}: {
  pdf: pdfjsLib.PDFDocumentProxy;
  pageNum: number;
  pageWidth: number;
  fields: ContractField[];
  /** Saved values keyed by field id — now the source of truth for signature
   * and tickmark fields too, not just text-like ones (a signature value is
   * the rendered PNG data URL for that exact box, so two signature fields
   * for the same signer can hold two independently-completed images). */
  fieldValues: Record<string, string>;
  /** Legacy fallback only: before per-field signing, one image was stored
   * per role on contract_signing_parties and reused for every signature
   * field that role had. Kept so an already-completed envelope signed under
   * the old model still renders correctly; a new submission always writes
   * into fieldValues instead, so this has nothing to contribute there. */
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
  /** Whether the signer has chosen a signature style yet — purely changes
   * the placeholder copy on an unsigned box ("Choose your signature below
   * first" vs "Tap to sign") so it's never a dead end with no explanation. */
  signatureReady?: boolean;
  /** Fires when the signer taps one of their own unsigned signature boxes —
   * this is what makes signing go box by box instead of one typed name
   * silently stamping every signature field for that role. Each field is its
   * own click, its own stored value, and (server-side) its own audit event. */
  onSignField?: (fieldId: string) => void;
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

        if (f.type === 'tickmark') {
          const checked = fieldValues[f.id] === 'true';
          const isMine = f.role === activeRole;
          if (isMine && !checked && editableValues && onEditableChange) {
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={editableValues[f.id] === 'true'}
                onClick={() => onEditableChange(f.id, editableValues[f.id] === 'true' ? 'false' : 'true')}
                className="absolute flex items-center justify-center rounded-sm border-2 bg-white/95"
                style={{ left: `${f.xPct}%`, top: `${f.yPct}%`, width: `${f.wPct}%`, height: `${f.hPct}%`, borderColor: roleColor(f.role) }}
              >
                {editableValues[f.id] === 'true' && <Check className="h-full w-full p-[12%]" style={{ color: roleColor(f.role) }} />}
              </button>
            );
          }
          // Already saved (checked=true) or someone else's box — read-only.
          return (
            <div
              key={f.id}
              className="absolute flex items-center justify-center rounded-sm border-2 bg-white/60"
              style={{ left: `${f.xPct}%`, top: `${f.yPct}%`, width: `${f.wPct}%`, height: `${f.hPct}%`, borderColor: roleColor(f.role) }}
            >
              {checked && <Check className="h-full w-full p-[12%]" style={{ color: roleColor(f.role) }} />}
            </div>
          );
        }

        if (f.type !== 'signature') return null;

        // Per-field value first — this is one specific box's own completed
        // signature, not whatever that role last signed elsewhere. Falls
        // back to the legacy one-per-role image only when no per-field value
        // was ever recorded (an envelope completed before this existed).
        const ownValue = fieldValues[f.id];
        const legacySig = !ownValue ? signatures.find((s) => s.role === f.role) : undefined;
        const imageUrl = ownValue || legacySig?.signatureDataUrl;
        if (imageUrl) {
          return (
            <img
              key={f.id}
              src={imageUrl}
              alt=""
              className="absolute object-contain"
              style={{ left: `${f.xPct}%`, top: `${f.yPct}%`, width: `${f.wPct}%`, height: `${f.hPct}%` }}
            />
          );
        }

        const isMine = f.role === activeRole;
        if (isMine && onSignField) {
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onSignField(f.id)}
              disabled={!signatureReady}
              className="absolute rounded-sm border-2 border-dashed bg-white/70 text-left transition-colors hover:bg-white disabled:cursor-not-allowed"
              style={{ borderColor: roleColor(f.role), left: `${f.xPct}%`, top: `${f.yPct}%`, width: `${f.wPct}%`, height: `${f.hPct}%` }}
            >
              <span className="pointer-events-none px-1 text-[9px] font-semibold" style={{ color: roleColor(f.role) }}>
                {signatureReady ? 'Tap to sign ✍' : 'Choose your signature below first'}
              </span>
            </button>
          );
        }

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
