import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileText, Inbox, Loader2, Map, Send, Trash2, Upload } from 'lucide-react';
import {
  useUploadDocTemplate,
  useDeleteDocTemplate,
  useSignedTemplateUrl,
  type ContractType,
  type DocTemplate,
} from '@/hooks/useDocTemplates';
import { useContractInstances } from '@/hooks/useContractInstances';
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
 * One category of templates — a contract deal type (Cash, Novation, ...) or
 * the single flat LOI category — sharing the exact same upload → map →
 * invite-to-sign → sign-inbox mechanism either way, just with or without a
 * contractType underneath.
 */
export function TemplateCategoryCard({
  label,
  docType,
  contractType,
  items,
  onOpenMapper,
  onSend,
  onOpenInbox,
  onDeleteTarget,
}: {
  label: string;
  docType: 'loi' | 'contract';
  contractType?: ContractType;
  items: DocTemplate[];
  onOpenMapper: (t: DocTemplate) => void;
  onSend: (t: DocTemplate) => void;
  onOpenInbox: (t: DocTemplate) => void;
  onDeleteTarget: (t: { id: string; storagePath: string | null; docxStoragePath: string | null }) => void;
}) {
  const { data: instances = [] } = useContractInstances();
  const upload = useUploadDocTemplate();
  const deleteTemplate = useDeleteDocTemplate();
  const getSignedUrl = useSignedTemplateUrl();
  const [uploading, setUploading] = useState(false);
  const pdfInput = useRef<HTMLInputElement>(null);
  const docxInput = useRef<HTMLInputElement>(null);
  const pendingDocx = useRef<File | undefined>(undefined);

  async function handlePdfFile(file: File) {
    setUploading(true);
    try {
      const template = await upload.mutateAsync({ docType, contractType, pdfFile: file, docxFile: pendingDocx.current });
      pendingDocx.current = undefined;
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
        <div className="text-sm font-semibold text-text">{label}</div>
        {items.length === 0 && (
          <div className="flex items-center gap-1.5">
            <button
              className="btn !px-2.5 !py-1.5 text-[11px]"
              onClick={() => docxInput.current?.click()}
              title="Attach an optional Word original (reference only) before uploading the PDF"
            >
              + Word (optional)
            </button>
            <button className="btn !px-3 !py-1.5 text-[12px]" disabled={uploading} onClick={() => pdfInput.current?.click()}>
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              Upload template
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
        <input
          ref={docxInput}
          type="file"
          className="hidden"
          accept=".doc,.docx"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              pendingDocx.current = file;
              pdfInput.current?.click();
            }
            e.target.value = '';
          }}
        />
      </div>

      {items.length === 0 ? (
        <p className="mt-2 text-[12px] text-text-3">No {label.toLowerCase()} template uploaded yet.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {items.map((t) => {
            const inboxCount = instances.filter((i) => i.templateId === t.id).length;
            return (
              <div key={t.id} className="flex items-center justify-between rounded-md border border-border-2 bg-surface-3 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <FileText size={20} className="shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-text">{t.name}</div>
                    <div className="text-[11px] text-text-3">Created {formatDate(t.createdAt)}</div>
                  </div>
                  {!t.mapped && (
                    <span className="shrink-0 rounded-full bg-warning-dim px-1.5 py-0.5 text-[10px] font-semibold text-warning">Not mapped</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {t.mapped ? (
                    <>
                      <button className="px-1 text-[12px] font-medium text-text-2 hover:text-text" onClick={() => onOpenMapper(t)}>
                        Edit
                      </button>
                      <button className="btn btn-primary !px-2.5 !py-1.5 text-[11px]" onClick={() => onSend(t)}>
                        <Send size={12} /> Invite to Sign
                      </button>
                      <button className="btn !px-2.5 !py-1.5 text-[11px]" onClick={() => onOpenInbox(t)}>
                        <Inbox size={12} /> Sign Inbox
                        <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">{inboxCount}</span>
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
