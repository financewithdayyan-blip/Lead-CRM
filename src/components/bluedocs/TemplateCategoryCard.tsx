import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FilePlus2, FileText, Loader2, Map, Send, Trash2, Upload } from 'lucide-react';
import {
  useUploadDocTemplate,
  useDeleteDocTemplate,
  useSignedTemplateUrl,
  type ContractType,
  type DocTemplate,
} from '@/hooks/useDocTemplates';
import { formatDate } from '@/lib/utils';

/** Small overflow menu — Download/Delete tucked away, matching the
 * Jotform-style document row this is modeled on. */
function MoreMenu({ onDownload, onDelete }: { onDownload: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button className="btn !px-2 !py-1.5 text-[11px]" onClick={() => setOpen((v) => !v)}>
        More <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-36 rounded-md border border-border bg-white py-1 shadow-popover">
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text hover:bg-surface-3"
            onClick={() => {
              setOpen(false);
              onDownload();
            }}
          >
            <Download size={12} /> Download
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-danger hover:bg-surface-3"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One category of templates — sharing the exact same upload → map →
 * invite-to-sign → sign-inbox mechanism regardless of what's underneath.
 */
export function TemplateCategoryCard({
  label,
  docType,
  contractType,
  typeOptions,
  items,
  multi,
  onOpenMapper,
  onSend,
  onDeleteTarget,
}: {
  label: string;
  docType: 'loi' | 'contract';
  contractType?: ContractType;
  /** When set, this card spans several deal types at once (e.g. "Purchase
   * Contracts" holding Cash/Novation/Subject-To/Seller Finance together) —
   * uploads stay open like `multi`, but the admin picks which of these
   * types a new template is for, and each row shows that type as a badge. */
  typeOptions?: Array<{ key: ContractType; label: string }>;
  items: DocTemplate[];
  /** A fixed-slot category holds one template — the upload button hides
   * once that slot is filled. This card is an open-ended bucket instead
   * (e.g. "Others"), so the button stays visible to add more, and its
   * label reads as adding a new contract rather than filling one slot. */
  multi?: boolean;
  onOpenMapper: (t: DocTemplate) => void;
  onSend: (t: DocTemplate) => void;
  onDeleteTarget: (t: { id: string; storagePath: string | null; docxStoragePath: string | null }) => void;
}) {
  const upload = useUploadDocTemplate();
  const deleteTemplate = useDeleteDocTemplate();
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
    <div className="card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FileText size={14} />
          </span>
          <div className="text-sm font-semibold text-text">{label}</div>
          {items.length > 0 && (
            <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-text-3">{items.length}</span>
          )}
        </div>
        {(items.length === 0 || alwaysOpen) && (
          <div className="flex items-center gap-1.5">
            <button className="btn btn-primary !px-3 !py-1.5 text-[12px]" disabled={uploading} onClick={() => pdfInput.current?.click()}>
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {alwaysOpen ? 'Add Contract' : 'Upload template'}
            </button>
          </div>
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
      </div>

      {items.length === 0 ? (
        <div className="mt-3 flex items-center gap-2.5 rounded-md border border-dashed border-border-2 px-3 py-3 text-text-3">
          <FilePlus2 size={16} className="shrink-0" />
          <p className="text-[12px]">{alwaysOpen ? 'No contracts added here yet.' : `No ${label.toLowerCase()} template uploaded yet.`}</p>
        </div>
      ) : (
        <div className="mt-3 space-y-1.5">
          {items.map((t) => {
            const typeLabel = typeOptions?.find((o) => o.key === t.contractType)?.label;
            return (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-md border border-border-2 bg-surface-3 px-3 py-2.5 transition-colors hover:border-border hover:bg-surface-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <FileText size={17} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-text">{t.name}</div>
                    <div className="text-[11px] text-text-3">Created {formatDate(t.createdAt)}</div>
                  </div>
                  {typeLabel && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{typeLabel}</span>
                  )}
                  {!t.mapped && (
                    <span className="shrink-0 rounded-full bg-warning-dim px-1.5 py-0.5 text-[10px] font-semibold text-warning">Not mapped</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {t.mapped ? (
                    <>
                      <button className="btn !px-2.5 !py-1.5 text-[11px]" onClick={() => onOpenMapper(t)}>
                        Edit
                      </button>
                      <button className="btn btn-primary !px-2.5 !py-1.5 text-[11px]" onClick={() => onSend(t)}>
                        <Send size={12} /> Invite to Sign
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-primary !px-2.5 !py-1.5 text-[11px]" onClick={() => onOpenMapper(t)}>
                      <Map size={12} /> Map Fields
                    </button>
                  )}
                  <MoreMenu
                    onDownload={() => t.storagePath && handleDownload(t.storagePath, t.fileName || t.name)}
                    onDelete={() => onDeleteTarget({ id: t.id, storagePath: t.storagePath, docxStoragePath: t.docxStoragePath })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
