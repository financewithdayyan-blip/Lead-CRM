import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ContractInstanceRow } from './ContractInstanceRow';
import { ContractPreviewModal } from './ContractPreviewModal';
import { useContractInstances, useDeleteContractInstance, type ContractInstance } from '@/hooks/useContractInstances';
import { useSignedTemplateUrl } from '@/hooks/useDocTemplates';
import type { DocTemplate } from '@/hooks/useDocTemplates';

/** Partial + Signed contracts generated from one specific template. */
export function SignInboxModal({ template, onClose }: { template: DocTemplate; onClose: () => void }) {
  const { data: instances = [] } = useContractInstances();
  const deleteInstance = useDeleteContractInstance();
  const getSignedUrl = useSignedTemplateUrl();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<ContractInstance | null>(null);

  const forTemplate = instances.filter((i) => i.templateId === template.id);
  const partial = forTemplate.filter((i) => i.status === 'partial');
  const signed = forTemplate.filter((i) => i.status === 'signed');

  async function download(path: string, name: string) {
    const url = await getSignedUrl.mutateAsync(path);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.pdf`;
    a.click();
  }

  return (
    <Modal open onClose={onClose} title={`Sign Inbox — ${template.name}`} width="lg">
      <div className="max-h-[70vh] space-y-4 overflow-y-auto">
        <div>
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">Partially Filled ({partial.length})</div>
          {partial.length === 0 ? (
            <p className="text-[12px] text-text-3">Nothing awaiting signatures right now.</p>
          ) : (
            <div className="space-y-1.5">
              {partial.map((c) => (
                <ContractInstanceRow
                  key={c.id}
                  instance={c}
                  showTemplateName={false}
                  onPreview={() => setPreviewTarget(c)}
                  onDownload={download}
                  onDelete={() => setDeleteTarget(c.id)}
                />
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">Signed ({signed.length})</div>
          {signed.length === 0 ? (
            <p className="text-[12px] text-text-3">No fully executed contracts yet.</p>
          ) : (
            <div className="space-y-1.5">
              {signed.map((c) => (
                <ContractInstanceRow
                  key={c.id}
                  instance={c}
                  showTemplateName={false}
                  onPreview={() => setPreviewTarget(c)}
                  onDownload={download}
                  onDelete={() => setDeleteTarget(c.id)}
                />
              ))}
            </div>
          )}
        </div>
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
    </Modal>
  );
}
