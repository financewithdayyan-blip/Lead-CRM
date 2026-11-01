import { useRef, useState } from 'react';
import { ChevronDown, Download, FilePlus2, FileText, Loader2, Map, Pencil, Plus, Send, Trash2, Upload } from 'lucide-react';
import {
  useUploadDocTemplate,
  useSignedTemplateUrl,
  type ContractType,
  type DocTemplate,
} from '@/hooks/useDocTemplates';
import { DropdownMenu } from '@/components/ui/DropdownMenu';

/** Small overflow menu tucked into a tile's corner — Download/Edit/Delete,
 * kept out of the tile's main action slot so that stays reserved for the
 * one primary next step (Map Fields or Invite to Sign). */
function MoreMenu({ onEdit, onDownload, onDelete }: { onEdit?: () => void; onDownload: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu
      width="w-36"
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text"
          onClick={onClick}
        >
          <ChevronDown size={14} />
        </button>
      )}
    >
      {(close) => (
        <>
          {onEdit && (
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text hover:bg-surface-3"
              onClick={() => {
                close();
                onEdit();
              }}
            >
              <Pencil size={12} /> Edit fields
            </button>
          )}
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text hover:bg-surface-3"
            onClick={() => {
              close();
              onDownload();
            }}
          >
            <Download size={12} /> Download
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-danger hover:bg-surface-3"
            onClick={() => {
              close();
              onDelete();
            }}
          >
            <Trash2 size={12} /> Delete
          </button>
        </>
      )}
    </DropdownMenu>
  );
}

function TemplateTile({
  t,
  color,
  usageCount,
  onOpenMapper,
  onSend,
  onDownload,
  onDeleteTarget,
}: {
  t: DocTemplate;
  color: string;
  usageCount: number;
  onOpenMapper: (t: DocTemplate) => void;
  onSend: (t: DocTemplate) => void;
  onDownload: (storagePath: string, fileName: string) => void;
  onDeleteTarget: (t: { id: string; storagePath: string | null; docxStoragePath: string | null }) => void;
}) {
  const fieldCount = t.fields.filter((f) => f.type !== 'signature').length;
  const signerCount = 2 + t.partyRoles.length;
  // Cosmetic only — the stored name/upload filename is untouched, this
  // just reads better than a raw "Assignment_of_Purchase_Contract.pdf".
  const displayName = t.name.replace(/\.(pdf|docx?|png|jpe?g)$/i, '').replace(/_/g, ' ').trim();

  return (
    <div
      className="flex w-[210px] shrink-0 cursor-pointer snap-start flex-col rounded-lg border border-border-2 bg-surface-3 p-4 transition-colors hover:border-border hover:bg-surface-2"
      onClick={() => (t.mapped ? onSend(t) : onOpenMapper(t))}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md" style={{ background: `${color}1f`, color }}>
          <FileText size={20} />
        </span>
        <MoreMenu
          onEdit={t.mapped ? () => onOpenMapper(t) : undefined}
          onDownload={() => t.storagePath && onDownload(t.storagePath, t.fileName || t.name)}
          onDelete={() => onDeleteTarget({ id: t.id, storagePath: t.storagePath, docxStoragePath: t.docxStoragePath })}
        />
      </div>

      <div className="mt-3 min-h-[52px] min-w-0">
        <div className="line-clamp-2 text-[14px] font-semibold leading-snug text-text" title={displayName}>{displayName}</div>
        <div className="mt-1 text-[12px] text-text-3">
          {fieldCount} field{fieldCount === 1 ? '' : 's'}, {signerCount} signer{signerCount === 1 ? '' : 's'}
        </div>
      </div>

      {!t.mapped && (
        <span className="mt-2 inline-block w-fit rounded-full bg-warning-dim px-1.5 py-0.5 text-[10px] font-semibold text-warning">Not mapped</span>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border-2 pt-3">
        <span className="min-w-0 truncate text-[11.5px] font-semibold" style={{ color }}>
          {usageCount > 0 ? `Used ${usageCount}×` : ''}
        </span>
        {t.mapped ? (
          <button className="btn btn-primary shrink-0 !px-2.5 !py-1.5 text-[11px]" onClick={(e) => { e.stopPropagation(); onSend(t); }}>
            <Send size={11} /> Invite
          </button>
        ) : (
          <button className="btn btn-primary shrink-0 !px-2.5 !py-1.5 text-[11px]" onClick={(e) => { e.stopPropagation(); onOpenMapper(t); }}>
            <Map size={11} /> Map Fields
          </button>
        )}
      </div>
    </div>
  );
}

function AddTile({ label, sub, uploading, onPick }: { label: string; sub: string; uploading: boolean; onPick: () => void }) {
  return (
    <button
      className="flex w-[210px] shrink-0 snap-start flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-2 p-4 text-center transition-colors hover:border-border hover:bg-surface-3"
      disabled={uploading}
      onClick={onPick}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
        {uploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
      </span>
      <div>
        <div className="text-[14.5px] font-semibold text-text">{label}</div>
        <div className="mt-1 text-[12px] text-text-3">{sub}</div>
      </div>
    </button>
  );
}

/**
 * One category of templates — contributes its items plus a trailing "add"
 * tile to the shared Templates grid the parent renders. Shares the exact
 * same upload → map → invite-to-sign → sign-inbox mechanism regardless of
 * what's underneath; this component owns none of its own card chrome
 * anymore (no wrapping background/border) so its tiles sit directly in the
 * parent's grid alongside every other category's.
 */
export function TemplateCategoryCard({
  label,
  docType,
  contractType,
  typeOptions,
  items,
  multi,
  colorFor,
  usageByTemplateId,
  onOpenMapper,
  onSend,
  onDeleteTarget,
}: {
  label: string;
  docType: 'loi' | 'contract';
  contractType?: ContractType;
  /** When set, this card spans several deal types at once (e.g. "Purchase
   * Contracts" holding Cash/Novation/Subject-To/Seller Finance together) —
   * uploads stay open like `multi`, picking whichever type is first in the
   * list (matching the existing upload behavior this redesign didn't change). */
  typeOptions?: Array<{ key: ContractType; label: string }>;
  items: DocTemplate[];
  /** A fixed-slot category holds one template — the add tile hides once
   * that slot is filled. This card is an open-ended bucket instead (e.g.
   * "Others"), so the add tile stays visible to add more. */
  multi?: boolean;
  /** Tile icon/accent color, per item — lets the parent color-code by
   * contract type (Cash/Novation/Subject-To/Seller Finance) even within
   * one category. */
  colorFor: (t: DocTemplate) => string;
  usageByTemplateId: Map<string, number>;
  onOpenMapper: (t: DocTemplate) => void;
  onSend: (t: DocTemplate) => void;
  onDeleteTarget: (t: { id: string; storagePath: string | null; docxStoragePath: string | null }) => void;
}) {
  const upload = useUploadDocTemplate();
  const getSignedUrl = useSignedTemplateUrl();
  const [uploading, setUploading] = useState(false);
  const pickedType = typeOptions?.[0]?.key;
  const pdfInput = useRef<HTMLInputElement>(null);
  const alwaysOpen = multi || !!typeOptions;

  async function handlePdfFile(file: File) {
    setUploading(true);
    try {
      const template = await upload.mutateAsync({
        docType,
        contractType: typeOptions ? pickedType : contractType,
        pdfFile: file,
      });
      onOpenMapper(template);
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(storagePath: string, fileName: string) {
    const url = await getSignedUrl.mutateAsync(storagePath);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  }

  return (
    <>
      {items.length === 0 && !alwaysOpen && (
        <div className="flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md border border-dashed border-border-2 px-3 py-3 text-text-3">
          <FilePlus2 size={16} className="shrink-0" />
          <p className="text-[12px]">No {label.toLowerCase()} template uploaded yet.</p>
        </div>
      )}
      {items.map((t) => (
        <TemplateTile
          key={t.id}
          t={t}
          color={colorFor(t)}
          usageCount={usageByTemplateId.get(t.id) ?? 0}
          onOpenMapper={onOpenMapper}
          onSend={onSend}
          onDownload={handleDownload}
          onDeleteTarget={onDeleteTarget}
        />
      ))}
      {(items.length === 0 || alwaysOpen) && (
        <AddTile
          label={alwaysOpen ? `Add ${label === 'Others' ? 'document' : 'purchase contract'}` : `Upload ${label.toLowerCase()}`}
          sub="PDF in, map the fields, ready to send"
          uploading={uploading}
          onPick={() => pdfInput.current?.click()}
        />
      )}
      <input
        ref={pdfInput}
        type="file"
        className="hidden"
        accept=".pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handlePdfFile(file);
          e.target.value = '';
        }}
      />
    </>
  );
}
