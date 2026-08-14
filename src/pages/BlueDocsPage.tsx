import { useState } from 'react';
import { Check, Copy, FileSignature, ScrollText, Send } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { ContractFieldMapper } from '@/components/bluedocs/ContractFieldMapper';
import { SendContractModal } from '@/components/bluedocs/SendContractModal';
import { TemplateCategoryCard } from '@/components/bluedocs/TemplateCategoryCard';
import { useDocTemplates, useDeleteDocTemplate, useSignedTemplateUrl, type ContractType, type DocTemplate } from '@/hooks/useDocTemplates';

const CONTRACT_TYPES: Array<{ key: ContractType; label: string }> = [
  { key: 'cash', label: 'Cash Deal' },
  { key: 'novation', label: 'Novation' },
  { key: 'subject_to', label: 'Subject-To' },
  { key: 'seller_finance', label: 'Seller Finance' },
];

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

/** Shared upload → map → invite-to-sign → sign-inbox orchestration, used
 * identically by every template category (the 4 contract deal types and the
 * single LOI category) so each tab only needs to wire up its own cards. */
function useDocFlow() {
  const getSignedUrl = useSignedTemplateUrl();
  const deleteTemplate = useDeleteDocTemplate();
  const [mappingTarget, setMappingTarget] = useState<{ template: DocTemplate; pdfUrl: string } | null>(null);
  const [sendTarget, setSendTarget] = useState<DocTemplate | null>(null);
  const [firstSignerLink, setFirstSignerLink] = useState<{ label: string; url: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; storagePath: string | null; docxStoragePath: string | null } | null>(null);

  async function openMapper(t: DocTemplate) {
    if (!t.storagePath) return;
    const url = await getSignedUrl.mutateAsync(t.storagePath);
    setMappingTarget({ template: t, pdfUrl: url });
  }

  return {
    mappingTarget,
    sendTarget,
    setSendTarget,
    firstSignerLink,
    setFirstSignerLink,
    deleteTarget,
    setDeleteTarget,
    openMapper,
    closeMapper: () => setMappingTarget(null),
    deleteTemplate,
  };
}

function DocFlowModals({ flow }: { flow: ReturnType<typeof useDocFlow> }) {
  return (
    <>
      {flow.mappingTarget && (
        <ContractFieldMapper
          template={flow.mappingTarget.template}
          pdfUrl={flow.mappingTarget.pdfUrl}
          onClose={flow.closeMapper}
          onSaved={flow.closeMapper}
        />
      )}

      {flow.sendTarget && (
        <SendContractModal
          template={flow.sendTarget}
          onClose={() => flow.setSendTarget(null)}
          onSent={(l) => {
            flow.setSendTarget(null);
            flow.setFirstSignerLink(l);
          }}
        />
      )}

      {flow.firstSignerLink && (
        <Modal open onClose={() => flow.setFirstSignerLink(null)} title="Invitation sent" width="md">
          <p className="text-[13px] text-text-2">
            {flow.firstSignerLink.label.split(' — ')[0]} was just texted their signing link automatically. Each next
            party gets texted the same way as soon as it's their turn — track progress any time from Envelopes. Here's
            the link too, in case you want to share it another way.
          </p>
          <div className="mt-3">
            <SigningLinkRow label={flow.firstSignerLink.label} url={flow.firstSignerLink.url} />
          </div>
          <div className="mt-4 flex justify-end">
            <button className="btn btn-primary" onClick={() => flow.setFirstSignerLink(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!flow.deleteTarget}
        title="Delete this template?"
        message="This permanently removes the uploaded template."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (flow.deleteTarget) flow.deleteTemplate.mutate(flow.deleteTarget);
          flow.setDeleteTarget(null);
        }}
        onCancel={() => flow.setDeleteTarget(null)}
      />
    </>
  );
}

// ─── LOI tab ────────────────────────────────────────────────────────────────
function LoiGeneratorTab() {
  const { data: templates = [] } = useDocTemplates('loi');
  const flow = useDocFlow();

  return (
    <div className="space-y-5">
      <TemplateCategoryCard
        label="Letter of Intent"
        docType="loi"
        items={templates}
        onOpenMapper={flow.openMapper}
        onSend={flow.setSendTarget}
        onDeleteTarget={flow.setDeleteTarget}
      />
      <DocFlowModals flow={flow} />
    </div>
  );
}

// ─── Contract Templates tab ─────────────────────────────────────────────────
function ContractTemplatesTab() {
  const { data: templates = [] } = useDocTemplates('contract');
  const flow = useDocFlow();

  return (
    <div className="space-y-5">
      {CONTRACT_TYPES.map((ct) => (
        <TemplateCategoryCard
          key={ct.key}
          label={ct.label}
          docType="contract"
          contractType={ct.key}
          items={templates.filter((t) => t.contractType === ct.key)}
          onOpenMapper={flow.openMapper}
          onSend={flow.setSendTarget}
          onDeleteTarget={flow.setDeleteTarget}
        />
      ))}
      <TemplateCategoryCard
        label="Other Contracts"
        docType="contract"
        items={templates.filter((t) => t.contractType === null)}
        multi
        onOpenMapper={flow.openMapper}
        onSend={flow.setSendTarget}
        onDeleteTarget={flow.setDeleteTarget}
      />
      <DocFlowModals flow={flow} />
    </div>
  );
}

export function BlueDocsPage() {
  const [tab, setTab] = useState<'loi' | 'templates'>('loi');

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileSignature size={20} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold text-text">Blue Docs</h1>
          <p className="text-sm text-text-3">Contract templates, e-signing, and the LOI generator</p>
        </div>
      </div>

      <div className="mb-5 flex gap-1 border-b border-border">
        {(
          [
            ['loi', 'LOI Generator', Send],
            ['templates', 'Contracts', ScrollText],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors ${
              tab === key ? 'border-primary text-primary' : 'border-transparent text-text-3 hover:text-text'
            }`}
            onClick={() => setTab(key)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'loi' ? <LoiGeneratorTab /> : <ContractTemplatesTab />}
    </div>
  );
}
