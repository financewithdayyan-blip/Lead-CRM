import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Download, FileText, Loader2, Search, Trash2, Upload } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ContractPreviewModal } from '@/components/bluedocs/ContractPreviewModal';
import {
  useContractInstances,
  useSendContractReminder,
  type ContractInstance,
} from '@/hooks/useContractInstances';
import {
  useDocTemplates,
  useUploadDocTemplate,
  useDeleteDocTemplate,
  useSignedTemplateUrl,
  PURCHASE_CONTRACT_TYPES,
  roleColor,
  type ContractType,
  type DocTemplate,
} from '@/hooks/useDocTemplates';
import { bucketFor, findPendingParty, latestInstanceByTemplate } from '@/lib/contractBoard';
import { formatDate } from '@/lib/utils';

type FilterKey = 'all' | 'draft' | 'active' | 'completed';
const FILTER_TABS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'active', label: 'Out for signature' },
  { key: 'completed', label: 'Completed' },
];

const STATUS_DOT: Record<FilterKey, string> = {
  all: 'bg-text-3',
  draft: 'bg-text-3',
  active: 'bg-info',
  completed: 'bg-success',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A row's filter bucket — coarser than the Envelopes board's four buckets
 * since this table only offers three pills (Draft / Out for signature /
 * Completed); "Your Turn" folds into "Out for signature" here. */
function rowFilterKey(instance: ContractInstance | undefined): Exclude<FilterKey, 'all'> {
  if (!instance) return 'draft';
  const bucket = bucketFor(instance);
  if (bucket === 'completed') return 'completed';
  if (bucket === 'draft') return 'draft';
  return 'active';
}

function TemplateRow({
  template,
  typeLabel,
  instance,
  onOpenMapper,
  onSend,
  onDownload,
  onDelete,
  onPreview,
}: {
  template: DocTemplate;
  typeLabel?: string;
  instance: ContractInstance | undefined;
  onOpenMapper: () => void;
  onSend: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onPreview: (i: ContractInstance) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const sendReminder = useSendContractReminder();
  const [reminded, setReminded] = useState(false);

  const bucket = instance ? bucketFor(instance) : 'draft';
  const pendingParty = instance ? findPendingParty(instance) : undefined;
  const signHref = pendingParty ? `${window.location.origin}/crm/sign/${pendingParty.accessToken}` : null;
  const signedCount = instance?.parties.filter((p) => p.status === 'signed').length ?? 0;
  const totalParties = instance?.parties.length ?? 0;

  const statusLabel =
    bucket === 'draft'
      ? !template.mapped
        ? 'Draft'
        : instance
          ? 'Draft'
          : 'Draft'
      : bucket === 'completed'
        ? 'Completed'
        : bucket === 'yourTurn'
          ? 'Waiting on you'
          : 'Out for signature';
  const statusDetail =
    bucket === 'draft' ? (template.mapped ? 'Not sent yet' : 'Fields not placed') : `${signedCount} of ${totalParties} signed`;
  const statusColor = bucket === 'completed' ? '#22c55e' : bucket === 'draft' ? '#94a3b8' : bucket === 'yourTurn' ? '#f59e0b' : '#3b82f6';

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <tr className="border-b border-border-2 last:border-0 hover:bg-surface-2/60">
      <td className="py-2.5 pl-4 pr-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-text-3">
            <FileText size={14} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-text">{template.name}</div>
            {!template.mapped && <div className="text-[10.5px] font-medium text-warning">Not mapped</div>}
          </div>
        </div>
      </td>
      <td className="py-2.5 px-3">
        {typeLabel && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-semibold text-primary">{typeLabel}</span>}
      </td>
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-1.5 text-[11.5px] font-medium" style={{ color: statusColor }}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
          {statusLabel}
        </div>
        <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-surface-2">
          {bucket !== 'draft' && (
            <div className="h-full rounded-full" style={{ width: `${totalParties ? (signedCount / totalParties) * 100 : 0}%`, background: statusColor }} />
          )}
        </div>
        <div className="mt-0.5 text-[10.5px] text-text-3">{statusDetail}</div>
      </td>
      <td className="py-2.5 px-3">
        {instance && instance.parties.length > 0 ? (
          <div className="flex items-center gap-1">
            <div className="flex -space-x-1.5">
              {instance.parties.slice(0, 3).map((p) => (
                <span
                  key={p.id}
                  title={p.name}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-white text-[9.5px] font-bold text-white"
                  style={{ background: roleColor(p.role) }}
                >
                  {initials(p.name)}
                </span>
              ))}
            </div>
            <span className="text-[11px] text-text-3">{instance.parties.length}</span>
          </div>
        ) : (
          <span className="text-[11px] text-text-3">—</span>
        )}
      </td>
      <td className="py-2.5 px-3 text-[11.5px] text-text-3">{formatDate(instance?.createdAt ?? template.createdAt)}</td>
      <td className="py-2.5 pl-3 pr-4">
        <div className="flex items-center justify-end gap-1.5">
          {bucket === 'yourTurn' && signHref ? (
            <a
              href={signHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn !border-warning !bg-warning !px-2.5 !py-1.5 text-[11.5px] !text-white hover:!bg-warning/90"
            >
              Sign now
            </a>
          ) : bucket === 'sent' && pendingParty ? (
            <button
              className="btn btn-primary !px-2.5 !py-1.5 text-[11.5px]"
              disabled={sendReminder.isPending}
              onClick={() =>
                sendReminder.mutate(pendingParty.id, {
                  onSuccess: () => {
                    setReminded(true);
                    setTimeout(() => setReminded(false), 2000);
                  },
                })
              }
            >
              {sendReminder.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
              {reminded ? 'Sent' : 'Remind'}
            </button>
          ) : bucket === 'completed' && instance ? (
            <button className="btn !px-2.5 !py-1.5 text-[11.5px]" onClick={() => onPreview(instance)}>
              Certificate
            </button>
          ) : (
            <button className="btn !px-2.5 !py-1.5 text-[11.5px]" onClick={onOpenMapper}>
              {template.mapped ? 'Prepare' : 'Map Fields'}
            </button>
          )}

          <div ref={menuRef} className="relative">
            <button className="btn !p-1.5" onClick={() => setMenuOpen((v) => !v)}>
              <ChevronDown size={12} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={closeMenu} />
                <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border border-border bg-white py-1 shadow-popover">
                  {template.mapped && (
                    <button
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text hover:bg-surface-3"
                      onClick={() => {
                        closeMenu();
                        onSend();
                      }}
                    >
                      Invite to Sign
                    </button>
                  )}
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text hover:bg-surface-3"
                    onClick={() => {
                      closeMenu();
                      onOpenMapper();
                    }}
                  >
                    Edit fields
                  </button>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text hover:bg-surface-3"
                    onClick={() => {
                      closeMenu();
                      onDownload();
                    }}
                  >
                    <Download size={12} /> Download
                  </button>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-danger hover:bg-surface-3"
                    onClick={() => {
                      closeMenu();
                      onDelete();
                    }}
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

/**
 * One row per document template, its Status/Signers/Updated reflecting
 * whichever envelope was sent last for it — the full history of every send
 * for a reused template lives on the Envelopes board instead. Matches the
 * user's reference table exactly: grouped Purchase Contracts / Others
 * sections, All/Draft/Out for signature/Completed filter pills.
 */
export function ContractsTable({
  onOpenMapper,
  onSend,
}: {
  onOpenMapper: (t: DocTemplate) => void;
  onSend: (t: DocTemplate) => void;
}) {
  const { data: templates = [] } = useDocTemplates('contract');
  const { data: instances = [] } = useContractInstances();
  const upload = useUploadDocTemplate();
  const deleteTemplate = useDeleteDocTemplate();
  const getSignedUrl = useSignedTemplateUrl();

  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [previewInstance, setPreviewInstance] = useState<ContractInstance | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; storagePath: string | null; docxStoragePath: string | null } | null>(null);
  const [uploadingFor, setUploadingFor] = useState<'purchase' | 'others' | null>(null);
  const purchaseInput = useRef<HTMLInputElement>(null);
  const othersInput = useRef<HTMLInputElement>(null);

  const latestByTemplate = useMemo(() => latestInstanceByTemplate(instances), [instances]);

  const purchase = useMemo(
    () =>
      templates
        .filter((t) => t.contractType !== null)
        .sort(
          (a, b) =>
            PURCHASE_CONTRACT_TYPES.findIndex((o) => o.key === a.contractType) -
            PURCHASE_CONTRACT_TYPES.findIndex((o) => o.key === b.contractType),
        ),
    [templates],
  );
  const others = useMemo(() => templates.filter((t) => t.contractType === null), [templates]);

  const q = search.trim().toLowerCase();
  function matches(t: DocTemplate) {
    if (q && !t.name.toLowerCase().includes(q)) return false;
    if (filter === 'all') return true;
    return rowFilterKey(latestByTemplate.get(t.id)) === filter;
  }
  const purchaseVisible = purchase.filter(matches);
  const othersVisible = others.filter(matches);

  const awaitingCount = templates.filter((t) => rowFilterKey(latestByTemplate.get(t.id)) === 'active').length;

  async function handleUpload(file: File, section: 'purchase' | 'others') {
    setUploadingFor(section);
    try {
      const template = await upload.mutateAsync({
        docType: 'contract',
        contractType: section === 'purchase' ? PURCHASE_CONTRACT_TYPES[0].key : undefined,
        pdfFile: file,
      });
      onOpenMapper(template);
    } finally {
      setUploadingFor(null);
    }
  }

  async function handleDownload(t: DocTemplate) {
    if (!t.storagePath) return;
    const url = await getSignedUrl.mutateAsync(t.storagePath);
    const a = document.createElement('a');
    a.href = url;
    a.download = t.fileName || t.name;
    a.click();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-text">Contracts</h2>
          <p className="text-[12.5px] text-text-3">
            {templates.length} document{templates.length === 1 ? '' : 's'}
            {awaitingCount > 0 && ` · ${awaitingCount} awaiting counterparty signature`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {FILTER_TABS.map((t) => (
            <button
              key={t.key}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                filter === t.key ? 'bg-ink text-white' : 'border border-border-2 bg-white text-text-2 hover:bg-surface-3'
              }`}
              onClick={() => setFilter(t.key)}
            >
              {t.key !== 'all' && <span className={`h-1.5 w-1.5 rounded-full ${filter === t.key ? 'bg-white' : STATUS_DOT[t.key]}`} />}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mb-4 max-w-xs">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
        <input className="input !pl-7" placeholder="Search documents" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="overflow-hidden rounded-lg border border-border-2 bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-2 bg-surface-2/60 text-left text-[10.5px] font-semibold uppercase tracking-wide text-text-3">
              <th className="py-2 pl-4 pr-3 font-semibold">Document</th>
              <th className="py-2 px-3 font-semibold">Type</th>
              <th className="py-2 px-3 font-semibold">Status</th>
              <th className="py-2 px-3 font-semibold">Signers</th>
              <th className="py-2 px-3 font-semibold">Updated</th>
              <th className="py-2 pl-3 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border-2 bg-surface-2/40">
              <td colSpan={5} className="py-1.5 pl-4 text-[11px] font-bold uppercase tracking-wide text-primary">
                Purchase Contracts <span className="font-normal normal-case text-text-3">{purchase.length}</span>
              </td>
              <td className="py-1.5 pr-4 text-right">
                <button
                  className="btn btn-primary !px-2.5 !py-1 text-[11px]"
                  disabled={uploadingFor === 'purchase'}
                  onClick={() => purchaseInput.current?.click()}
                >
                  {uploadingFor === 'purchase' ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} Add Contract
                </button>
                <input
                  ref={purchaseInput}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file, 'purchase');
                    e.target.value = '';
                  }}
                />
              </td>
            </tr>
            {purchaseVisible.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-[12px] text-text-3">
                  {purchase.length === 0 ? 'No purchase contract templates uploaded yet.' : 'Nothing matches this filter.'}
                </td>
              </tr>
            ) : (
              purchaseVisible.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  typeLabel={PURCHASE_CONTRACT_TYPES.find((o) => o.key === t.contractType)?.label}
                  instance={latestByTemplate.get(t.id)}
                  onOpenMapper={() => onOpenMapper(t)}
                  onSend={() => onSend(t)}
                  onDownload={() => handleDownload(t)}
                  onDelete={() => setDeleteTarget({ id: t.id, storagePath: t.storagePath, docxStoragePath: t.docxStoragePath })}
                  onPreview={setPreviewInstance}
                />
              ))
            )}

            <tr className="border-b border-t border-border-2 bg-surface-2/40">
              <td colSpan={5} className="py-1.5 pl-4 text-[11px] font-bold uppercase tracking-wide text-primary">
                Others <span className="font-normal normal-case text-text-3">{others.length}</span>
              </td>
              <td className="py-1.5 pr-4 text-right">
                <button
                  className="btn btn-primary !px-2.5 !py-1 text-[11px]"
                  disabled={uploadingFor === 'others'}
                  onClick={() => othersInput.current?.click()}
                >
                  {uploadingFor === 'others' ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} Add Contract
                </button>
                <input
                  ref={othersInput}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file, 'others');
                    e.target.value = '';
                  }}
                />
              </td>
            </tr>
            {othersVisible.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-[12px] text-text-3">
                  {others.length === 0 ? 'No contracts added here yet.' : 'Nothing matches this filter.'}
                </td>
              </tr>
            ) : (
              othersVisible.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  instance={latestByTemplate.get(t.id)}
                  onOpenMapper={() => onOpenMapper(t)}
                  onSend={() => onSend(t)}
                  onDownload={() => handleDownload(t)}
                  onDelete={() => setDeleteTarget({ id: t.id, storagePath: t.storagePath, docxStoragePath: t.docxStoragePath })}
                  onPreview={setPreviewInstance}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this template?"
        message="This permanently removes the uploaded template."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (deleteTarget) deleteTemplate.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {previewInstance && <ContractPreviewModal instance={previewInstance} onClose={() => setPreviewInstance(null)} />}
    </div>
  );
}
