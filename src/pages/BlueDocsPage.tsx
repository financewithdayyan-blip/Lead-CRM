import { useState } from 'react';
import { Check, Copy, FileSignature, Inbox, ScrollText } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { ContractFieldMapper } from '@/components/bluedocs/ContractFieldMapper';
import { SendContractModal } from '@/components/bluedocs/SendContractModal';
import { FillCashDealContractModal, isCashDealTemplate } from '@/components/bluedocs/FillCashDealContractModal';
import { FillNovationContractModal, isNovationTemplate } from '@/components/bluedocs/FillNovationContractModal';
import { TemplateCategoryCard } from '@/components/bluedocs/TemplateCategoryCard';
import { EnvelopesTab } from '@/components/bluedocs/EnvelopesTab';
import {
  useDocTemplates,
  useDeleteDocTemplate,
  useSignedTemplateUrl,
  PURCHASE_CONTRACT_TYPES,
  type DocTemplate,
} from '@/hooks/useDocTemplates';
import type { DeliveryResult } from '@/hooks/useContractInstances';
import { AlertTriangle } from 'lucide-react';

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
  const [firstSignerLink, setFirstSignerLink] = useState<{ label: string; url: string; delivery: DeliveryResult } | null>(null);
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

/** Turns a raw per-channel send outcome into what the admin actually needs
 * to know — previously the modal always said "was just texted", regardless
 * of which channel(s) were even selected or whether the send actually
 * worked, which is exactly why silent SMTP/Zoom failures went unnoticed. */
function summarizeDelivery(delivery: DeliveryResult): { ok: boolean; message: string } {
  const sent: string[] = [];
  const failed: string[] = [];
  if (delivery.sms.attempted) (delivery.sms.sent ? sent : failed).push('text');
  if (delivery.email.attempted) (delivery.email.sent ? sent : failed).push('email');

  if (sent.length && !failed.length) {
    return { ok: true, message: `Sent by ${sent.join(' and ')} — they should have it now.` };
  }
  if (sent.length && failed.length) {
    return {
      ok: false,
      message: `Sent by ${sent.join(' and ')}, but the ${failed.join(' and ')} send failed. Share the link below directly to be safe.`,
    };
  }
  if (failed.length) {
    return { ok: false, message: `The ${failed.join(' and ')} send failed. Copy the link below and send it yourself.` };
  }
  return { ok: false, message: 'No delivery method was selected. Copy the link below and send it yourself.' };
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

      {flow.sendTarget && isCashDealTemplate(flow.sendTarget.id) && (
        <FillCashDealContractModal
          template={flow.sendTarget}
          onClose={() => flow.setSendTarget(null)}
          onSent={(l) => {
            flow.setSendTarget(null);
            flow.setFirstSignerLink(l);
          }}
        />
      )}

      {flow.sendTarget && isNovationTemplate(flow.sendTarget.id) && (
        <FillNovationContractModal
          template={flow.sendTarget}
          onClose={() => flow.setSendTarget(null)}
          onSent={(l) => {
            flow.setSendTarget(null);
            flow.setFirstSignerLink(l);
          }}
        />
      )}

      {flow.sendTarget && !isCashDealTemplate(flow.sendTarget.id) && !isNovationTemplate(flow.sendTarget.id) && (
        <SendContractModal
          template={flow.sendTarget}
          onClose={() => flow.setSendTarget(null)}
          onSent={(l) => {
            flow.setSendTarget(null);
            flow.setFirstSignerLink(l);
          }}
        />
      )}

      {flow.firstSignerLink && (() => {
        const summary = summarizeDelivery(flow.firstSignerLink.delivery);
        return (
          <Modal open onClose={() => flow.setFirstSignerLink(null)} title={summary.ok ? 'Invitation sent' : 'Invitation created'} width="md">
            {!summary.ok && (
              <div className="mb-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning-dim px-3 py-2 text-[12.5px] text-warning">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>{summary.message}</span>
              </div>
            )}
            <p className="text-[13px] text-text-2">
              {summary.ok ? (
                <>
                  {flow.firstSignerLink.label.split(' — ')[0]} — {summary.message} Each next party gets notified the
                  same way as soon as it's their turn — track progress any time from Envelopes. Here's the link too,
                  in case you want to share it another way.
                </>
              ) : (
                'The contract and its signing link were created below — copy it and send it to them directly.'
              )}
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
        );
      })()}

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

// ─── Contract Templates tab ─────────────────────────────────────────────────
// Every purchase-contract deal type (Cash, Novation, Subject-To, Seller
// Finance) lives together under one card — the admin picks the type at
// upload time instead of each type getting its own slot. Anything else
// (a JV agreement, a listing/marketing agreement, etc.) collects in Others.
function ContractTemplatesTab() {
  const { data: templates = [] } = useDocTemplates('contract');
  const flow = useDocFlow();

  return (
    <div className="space-y-5">
      <TemplateCategoryCard
        label="Purchase Contracts"
        docType="contract"
        typeOptions={PURCHASE_CONTRACT_TYPES}
        // Deal-type order (Cash, Novation, Subject-To, Seller Finance) rather
        // than upload recency — Cash Deal is the one actually in daily use
        // and should always lead the list, not whichever was (re)uploaded
        // most recently.
        items={templates
          .filter((t) => t.contractType !== null)
          .sort(
            (a, b) =>
              PURCHASE_CONTRACT_TYPES.findIndex((o) => o.key === a.contractType) -
              PURCHASE_CONTRACT_TYPES.findIndex((o) => o.key === b.contractType),
          )}
        onOpenMapper={flow.openMapper}
        onSend={flow.setSendTarget}
        onDeleteTarget={flow.setDeleteTarget}
      />
      <TemplateCategoryCard
        label="Others"
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
  const [tab, setTab] = useState<'templates' | 'envelopes'>('templates');

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileSignature size={20} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold text-text">Blue Docs</h1>
          <p className="text-sm text-text-3">Contract templates and e-signing</p>
        </div>
      </div>

      <div className="mb-5 flex gap-1 border-b border-border">
        {(
          [
            ['templates', 'Contracts', ScrollText],
            ['envelopes', 'Envelopes', Inbox],
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

      {tab === 'templates' ? <ContractTemplatesTab /> : <EnvelopesTab />}
    </div>
  );
}
