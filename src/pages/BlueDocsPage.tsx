import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Eye, FileSignature, FileText, Loader2, Map, Send, Trash2, Upload } from 'lucide-react';
import { MergeTagButtons } from '@/components/sms/MergeTagButtons';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { LeadPicker } from '@/components/bluedocs/LeadPicker';
import { ContractFieldMapper } from '@/components/bluedocs/ContractFieldMapper';
import { SendContractModal } from '@/components/bluedocs/SendContractModal';
import { ContractPreviewModal } from '@/components/bluedocs/ContractPreviewModal';
import {
  useDocTemplates,
  useSaveLoiTemplate,
  useUploadContractTemplate,
  useDeleteDocTemplate,
  useSignedTemplateUrl,
  type ContractType,
  type DocTemplate,
} from '@/hooks/useDocTemplates';
import {
  useGeneratedLois,
  useGenerateLoi,
  useArchiveGeneratedLoi,
  useDeleteGeneratedLoi,
  useLeadsForDocs,
  type LeadOption,
} from '@/hooks/useGeneratedLois';
import { useContractInstances, useDeleteContractInstance, type ContractInstance } from '@/hooks/useContractInstances';
import { renderMergeTags } from '@/lib/mergeTags';
import { downloadLoiPdf } from '@/lib/loiPdf';
import { formatDate } from '@/lib/utils';

const CONTRACT_TYPES: Array<{ key: ContractType; label: string }> = [
  { key: 'cash', label: 'Cash Deal' },
  { key: 'novation', label: 'Novation' },
  { key: 'subject_to', label: 'Subject-To' },
  { key: 'seller_finance', label: 'Seller Finance' },
];

function publicLoiUrl(slug: string) {
  return `${window.location.origin}/crm/loi/${slug}`;
}

// ─── LOI Generator tab ──────────────────────────────────────────────────────
function LoiGeneratorTab() {
  const { data: templates = [] } = useDocTemplates('loi');
  const template = templates[0];
  const saveTemplate = useSaveLoiTemplate();
  const { data: leads = [] } = useLeadsForDocs();
  const { data: generated = [] } = useGeneratedLois();
  const generateLoi = useGenerateLoi();
  const archiveLoi = useArchiveGeneratedLoi();
  const deleteLoi = useDeleteGeneratedLoi();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [body, setBody] = useState('');
  useEffect(() => {
    if (template) setBody(template.body ?? '');
  }, [template?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [savedFlash, setSavedFlash] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadOption | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const dirty = body !== (template?.body ?? '');
  const preview = selectedLead ? renderMergeTags(body, selectedLead) : body;

  async function handleSaveTemplate() {
    await saveTemplate.mutateAsync({ id: template?.id, name: 'Quick LOI', body });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  async function handleGenerate() {
    if (!selectedLead || !body.trim()) return;
    await generateLoi.mutateAsync({
      leadId: selectedLead.id,
      templateId: template?.id ?? null,
      body: preview,
      leadName: `${selectedLead.firstName} ${selectedLead.lastName}`.trim(),
      propertyAddress: selectedLead.address ?? '',
    });
    setSelectedLead(null);
  }

  function copyLink(slug: string) {
    navigator.clipboard.writeText(publicLoiUrl(slug));
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 1500);
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="text-sm font-semibold text-text">LOI template</div>
        <p className="mt-1 text-[13px] text-text-2">
          Write the Letter of Intent wording once, with merge tags — each generated LOI fills in that lead's own
          name and address.
        </p>
        <div className="mt-3 rounded-md border border-border-2 bg-surface-3 p-3">
          <textarea
            ref={textareaRef}
            className="input min-h-[160px] font-mono text-[12.5px]"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="LETTER OF INTENT&#10;&#10;Property: {{address}}&#10;Seller: {{first_name}} {{last_name}}&#10;..."
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <MergeTagButtons getTextarea={() => textareaRef.current} value={body} onChange={setBody} />
            <button className="btn btn-primary !px-3 !py-1 text-[12px] shrink-0" onClick={handleSaveTemplate} disabled={!dirty || saveTemplate.isPending}>
              {saveTemplate.isPending ? <Loader2 size={12} className="animate-spin" /> : savedFlash ? <Check size={12} /> : 'Save template'}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="text-sm font-semibold text-text">Generate a quick LOI</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Lead</label>
            <LeadPicker leads={leads} selected={selectedLead} onSelect={setSelectedLead} />
          </div>
          <div className="flex items-end">
            <button
              className="btn btn-primary w-full"
              disabled={!selectedLead || !body.trim() || generateLoi.isPending}
              onClick={handleGenerate}
            >
              {generateLoi.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileSignature size={14} />}
              Generate LOI
            </button>
          </div>
        </div>
        {selectedLead && (
          <div className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-border-2 bg-surface-3 p-3 text-[12.5px] text-text-2">
            {preview || 'Nothing to preview yet — write the template above.'}
          </div>
        )}
      </div>

      <div className="card !p-0">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-text">Generated LOIs</div>
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-border bg-surface-3 text-[11px] uppercase tracking-wide text-text-3">
            <tr>
              <th className="px-4 py-2.5">Lead</th>
              <th className="px-4 py-2.5">Address</th>
              <th className="px-4 py-2.5">Generated</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {generated.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-text-3">
                  No LOIs generated yet.
                </td>
              </tr>
            )}
            {generated.map((g) => (
              <tr key={g.id} className="border-b border-border">
                <td className="px-4 py-2.5 font-medium text-text">{g.leadName || '—'}</td>
                <td className="max-w-[220px] truncate px-4 py-2.5 text-text-2">{g.propertyAddress || '—'}</td>
                <td className="px-4 py-2.5 text-text-2">{formatDate(g.createdAt)}</td>
                <td className="px-4 py-2.5">
                  <button
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${g.status === 'active' ? 'bg-success-dim text-success' : 'bg-surface-3 text-text-3'}`}
                    onClick={() => archiveLoi.mutate({ id: g.id, status: g.status === 'active' ? 'archived' : 'active' })}
                    title="Click to toggle"
                  >
                    {g.status === 'active' ? 'Active' : 'Archived'}
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <button className="btn !px-2 !py-1 text-[11px]" onClick={() => copyLink(g.slug)} title="Copy shareable link">
                      {copiedSlug === g.slug ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                    <button
                      className="btn !px-2 !py-1 text-[11px]"
                      onClick={() => downloadLoiPdf(g.body, `LOI - ${g.leadName || 'lead'}`)}
                      title="Download as PDF"
                    >
                      <Download size={12} />
                    </button>
                    <button
                      className="btn !px-2 !py-1 text-[11px] text-danger"
                      onClick={() => setDeleteTarget(g.id)}
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this LOI?"
        message="This permanently deletes the generated LOI and breaks its shareable link."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (deleteTarget) deleteLoi.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── Contract Templates tab ─────────────────────────────────────────────────
function ContractTemplatesTab() {
  const { data: templates = [] } = useDocTemplates('contract');
  const upload = useUploadContractTemplate();
  const deleteTemplate = useDeleteDocTemplate();
  const getSignedUrl = useSignedTemplateUrl();
  const [uploadingType, setUploadingType] = useState<ContractType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; storagePath: string | null; docxStoragePath: string | null } | null>(null);
  const pdfInputs = useRef<Partial<Record<ContractType, HTMLInputElement | null>>>({});
  const docxInputs = useRef<Partial<Record<ContractType, HTMLInputElement | null>>>({});
  const pendingDocx = useRef<Partial<Record<ContractType, File>>>({});

  const [mappingTarget, setMappingTarget] = useState<{ template: DocTemplate; pdfUrl: string } | null>(null);
  const [sendTarget, setSendTarget] = useState<DocTemplate | null>(null);
  const [buyerLink, setBuyerLink] = useState<string | null>(null);

  async function handlePdfFile(contractType: ContractType, file: File) {
    setUploadingType(contractType);
    try {
      const template = await upload.mutateAsync({ contractType, pdfFile: file, docxFile: pendingDocx.current[contractType] });
      pendingDocx.current[contractType] = undefined;
      const url = await getSignedUrl.mutateAsync(template.storagePath!);
      setMappingTarget({ template, pdfUrl: url });
    } finally {
      setUploadingType(null);
    }
  }

  async function handleDownload(storagePath: string, fileName: string) {
    const url = await getSignedUrl.mutateAsync(storagePath);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  }

  async function openMapper(t: DocTemplate) {
    if (!t.storagePath) return;
    const url = await getSignedUrl.mutateAsync(t.storagePath);
    setMappingTarget({ template: t, pdfUrl: url });
  }

  return (
    <div className="space-y-4">
      {CONTRACT_TYPES.map((ct) => {
        const items = templates.filter((t) => t.contractType === ct.key);
        return (
          <div key={ct.key} className="card">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-text">{ct.label}</div>
              <div className="flex items-center gap-1.5">
                <button
                  className="btn !px-2.5 !py-1.5 text-[11px]"
                  onClick={() => docxInputs.current[ct.key]?.click()}
                  title="Attach an optional Word original (reference only) before uploading the PDF"
                >
                  + Word (optional)
                </button>
                <button
                  className="btn !px-3 !py-1.5 text-[12px]"
                  disabled={uploadingType === ct.key}
                  onClick={() => pdfInputs.current[ct.key]?.click()}
                >
                  {uploadingType === ct.key ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  Upload template
                </button>
              </div>
              <input
                ref={(el) => {
                  pdfInputs.current[ct.key] = el;
                }}
                type="file"
                className="hidden"
                accept=".pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handlePdfFile(ct.key, file);
                  e.target.value = '';
                }}
              />
              <input
                ref={(el) => {
                  docxInputs.current[ct.key] = el;
                }}
                type="file"
                className="hidden"
                accept=".doc,.docx"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    pendingDocx.current[ct.key] = file;
                    pdfInputs.current[ct.key]?.click();
                  }
                  e.target.value = '';
                }}
              />
            </div>
            {items.length === 0 ? (
              <p className="mt-2 text-[12px] text-text-3">No {ct.label.toLowerCase()} template uploaded yet.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {items.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-md border border-border-2 bg-surface-3 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText size={14} className="shrink-0 text-text-3" />
                      <span className="truncate text-[13px] font-medium text-text">{t.name}</span>
                      {!t.mapped && (
                        <span className="shrink-0 rounded-full bg-warning-dim px-1.5 py-0.5 text-[10px] font-semibold text-warning">Not mapped</span>
                      )}
                      <span className="shrink-0 text-[11px] text-text-3">{formatDate(t.createdAt)}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {t.mapped ? (
                        <>
                          <button className="btn !px-2 !py-1 text-[11px]" onClick={() => setSendTarget(t)}>
                            <Send size={12} /> Send Contract
                          </button>
                          <button className="btn !px-2 !py-1 text-[11px]" onClick={() => openMapper(t)}>
                            <Map size={12} /> Edit Mapping
                          </button>
                        </>
                      ) : (
                        <button className="btn btn-primary !px-2 !py-1 text-[11px]" onClick={() => openMapper(t)}>
                          <Map size={12} /> Map Fields
                        </button>
                      )}
                      <button
                        className="btn !px-2 !py-1 text-[11px]"
                        onClick={() => t.storagePath && handleDownload(t.storagePath, t.fileName || t.name)}
                      >
                        <Download size={12} />
                      </button>
                      <button
                        className="btn !px-2 !py-1 text-[11px] text-danger"
                        onClick={() => setDeleteTarget({ id: t.id, storagePath: t.storagePath, docxStoragePath: t.docxStoragePath })}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {mappingTarget && (
        <ContractFieldMapper
          template={mappingTarget.template}
          pdfUrl={mappingTarget.pdfUrl}
          onClose={() => setMappingTarget(null)}
          onSaved={() => setMappingTarget(null)}
        />
      )}

      {sendTarget && (
        <SendContractModal
          template={sendTarget}
          onClose={() => setSendTarget(null)}
          onSent={(l) => {
            setSendTarget(null);
            setBuyerLink(l.buyer);
          }}
        />
      )}

      {buyerLink && (
        <Modal open onClose={() => setBuyerLink(null)} title="Contract sent" width="md">
          <p className="text-[13px] text-text-2">
            Send this to the buyer — they'll fill in their fields and sign first. The seller's link unlocks
            automatically once the buyer's done, and you can find it in the Contracts tab from that point on.
          </p>
          <div className="mt-3">
            <SigningLinkRow label="Buyer link" url={buyerLink} />
          </div>
          <div className="mt-4 flex justify-end">
            <button className="btn btn-primary" onClick={() => setBuyerLink(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this template?"
        message="This permanently removes the uploaded contract template."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (deleteTarget) deleteTemplate.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function SigningLinkRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-border-2 bg-surface-3 p-2.5">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">{label}</div>
      <div className="flex items-center gap-2">
        <input readOnly className="input flex-1 !text-[11px]" value={url} onFocus={(e) => e.target.select()} />
        <button
          className="btn !px-2 !py-1.5"
          onClick={() => {
            navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

// ─── Contracts tab (partial / signed) ──────────────────────────────────────
function ContractsTab() {
  const { data: instances = [] } = useContractInstances();
  const deleteInstance = useDeleteContractInstance();
  const getSignedUrl = useSignedTemplateUrl();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<ContractInstance | null>(null);
  const [copiedPartyId, setCopiedPartyId] = useState<string | null>(null);

  function copyPartyLink(id: string, token: string) {
    navigator.clipboard.writeText(`${window.location.origin}/crm/sign/${token}`);
    setCopiedPartyId(id);
    setTimeout(() => setCopiedPartyId(null), 1500);
  }

  const partial = instances.filter((i) => i.status === 'partial');
  const signed = instances.filter((i) => i.status === 'signed');

  async function download(path: string, name: string) {
    const url = await getSignedUrl.mutateAsync(path);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.pdf`;
    a.click();
  }

  function Row({ c }: { c: (typeof instances)[number] }) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border-2 bg-surface-3 px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-text">{c.name}</div>
          <div className="truncate text-[11px] text-text-3">
            {c.leadName || 'Unknown lead'} · {c.templateName} · {formatDate(c.createdAt)}
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
          <button className="btn !px-2 !py-1 text-[11px]" onClick={() => setPreviewTarget(c)}>
            <Eye size={12} /> Preview
          </button>
          {c.status === 'signed' && c.finalStoragePath && (
            <button className="btn !px-2 !py-1 text-[11px]" onClick={() => download(c.finalStoragePath!, c.name)}>
              <Download size={12} /> Download signed PDF
            </button>
          )}
          <button className="btn !px-2 !py-1 text-[11px] text-danger" onClick={() => setDeleteTarget(c.id)}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-2 text-sm font-semibold text-text">Partially Filled ({partial.length})</div>
        {partial.length === 0 ? (
          <p className="text-[12px] text-text-3">Nothing awaiting signatures right now.</p>
        ) : (
          <div className="space-y-1.5">
            {partial.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <div className="mb-2 text-sm font-semibold text-text">Signed Contracts ({signed.length})</div>
        {signed.length === 0 ? (
          <p className="text-[12px] text-text-3">No fully executed contracts yet.</p>
        ) : (
          <div className="space-y-1.5">
            {signed.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this contract?"
        message="This permanently deletes the contract and its signing links."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (deleteTarget) deleteInstance.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {previewTarget && <ContractPreviewModal instance={previewTarget} onClose={() => setPreviewTarget(null)} />}
    </div>
  );
}

export function BlueDocsPage() {
  const [tab, setTab] = useState<'loi' | 'templates' | 'contracts'>('loi');

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-text">Blue Docs</h1>
        <p className="text-sm text-text-3">Contract templates, e-signing, and the LOI generator</p>
      </div>

      <div className="mb-4 flex gap-1 border-b border-border">
        {(
          [
            ['loi', 'LOI Generator'],
            ['templates', 'Contract Templates'],
            ['contracts', 'Contracts'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={`px-4 py-2 text-[13px] font-medium ${tab === key ? 'border-b-2 border-primary text-primary' : 'text-text-3 hover:text-text'}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'loi' ? <LoiGeneratorTab /> : tab === 'templates' ? <ContractTemplatesTab /> : <ContractsTab />}
    </div>
  );
}
