import { useEffect, useMemo, useState } from 'react';
import { Eye, PenLine, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ContractDocumentPage } from './ContractDocumentPreview';
import { useSignedTemplateUrl, roleLabel } from '@/hooks/useDocTemplates';
import { useContractAuditEvents, type ContractInstance } from '@/hooks/useContractInstances';
import { loadPdf, type pdfjsLib } from '@/lib/pdfjs';
import { formatDateTime } from '@/lib/utils';

const PAGE_WIDTH = 620;

export function ContractPreviewModal({ instance, onClose }: { instance: ContractInstance; onClose: () => void }) {
  const [tab, setTab] = useState<'document' | 'audit'>('document');
  const getSignedUrl = useSignedTemplateUrl();
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const { data: events = [], isLoading: eventsLoading } = useContractAuditEvents(instance.id);

  useEffect(() => {
    if (!instance.templateStoragePath) return;
    getSignedUrl.mutateAsync(instance.templateStoragePath).then((url) => loadPdf(url)).then(setPdf);
  }, [instance.templateStoragePath]); // eslint-disable-line react-hooks/exhaustive-deps

  const numPages = pdf?.numPages ?? 0;
  const pageNums = useMemo(() => Array.from({ length: numPages }, (_, i) => i + 1), [numPages]);

  const signatures = instance.parties
    .filter((p) => p.signatureDataUrl)
    .map((p) => ({ role: p.role, signatureDataUrl: p.signatureDataUrl! }));

  const partyById = new Map(instance.parties.map((p) => [p.id, p]));

  return (
    <Modal open onClose={onClose} title={instance.name} width="lg">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] text-text-2">
          {instance.leadName || 'Unknown lead'} · {instance.templateName} ·{' '}
          <span className={instance.status === 'signed' ? 'font-medium text-success' : 'font-medium text-warning'}>
            {instance.status === 'signed' ? 'Signed' : 'Partial'}
          </span>
        </p>
        <div className="flex gap-1">
          <button
            className={`btn !px-2.5 !py-1.5 text-[12px] ${tab === 'document' ? 'btn-primary' : ''}`}
            onClick={() => setTab('document')}
          >
            <Eye size={13} /> Document
          </button>
          <button
            className={`btn !px-2.5 !py-1.5 text-[12px] ${tab === 'audit' ? 'btn-primary' : ''}`}
            onClick={() => setTab('audit')}
          >
            <PenLine size={13} /> Audit Trail
          </button>
        </div>
      </div>

      {tab === 'document' ? (
        <div className="max-h-[70vh] overflow-y-auto">
          {!pdf ? (
            <div className="flex h-80 items-center justify-center text-text-3">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : (
            pageNums.map((n) => (
              <ContractDocumentPage
                key={n}
                pdf={pdf}
                pageNum={n}
                pageWidth={PAGE_WIDTH}
                fields={instance.templateFields}
                fieldValues={instance.fieldValues}
                signatures={signatures}
                docType={instance.templateType ?? 'contract'}
                partyRoles={instance.templatePartyRoles}
              />
            ))
          )}
        </div>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto">
          {eventsLoading && (
            <div className="flex h-40 items-center justify-center text-text-3">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
          {!eventsLoading && events.length === 0 && (
            <p className="py-8 text-center text-[13px] text-text-3">No activity recorded yet.</p>
          )}
          {!eventsLoading && events.length > 0 && (
            <div className="space-y-2">
              {events.map((e) => {
                const party = e.partyId ? partyById.get(e.partyId) : undefined;
                return (
                  <div key={e.id} className="flex items-start gap-3 rounded-md border border-border-2 bg-surface-3 px-3 py-2">
                    <span
                      className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${e.eventType === 'signed' ? 'bg-success' : 'bg-info'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-text">
                        <span className="font-medium">
                          {party ? roleLabel(party.role, instance.templateType ?? 'contract', instance.templatePartyRoles) : 'Unknown party'}
                        </span>
                        {party ? ` (${party.name})` : ''} {e.eventType === 'signed' ? 'signed the document' : 'opened the signing link'}
                      </div>
                      <div className="mt-0.5 text-[11px] text-text-3">
                        {formatDateTime(e.createdAt)}
                        {e.ipAddress ? ` · ${e.ipAddress}` : ''}
                        {e.userAgent ? ` · ${e.userAgent}` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
