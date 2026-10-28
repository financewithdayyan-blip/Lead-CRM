import { useParams } from 'react-router-dom';
import { Loader2, ShieldCheck, FileX } from 'lucide-react';
import { usePublicContractVerification, partyNameAtEvent, type ContractAuditEvent } from '@/hooks/useContractInstances';
import { roleLabel } from '@/hooks/useDocTemplates';
import { formatDateTime } from '@/lib/utils';

// Mirrors submit-signature's own EVENT_LABELS (the Certificate of
// Completion's copy) and ContractPreviewModal's EVENT_ACTION_TEXT — this is
// the third rendering of the same event vocabulary, now as a public page
// rather than PDF text or an admin-only tab.
const EVENT_LABELS: Record<string, string> = {
  sent: 'Invitation sent',
  viewed: 'Document viewed',
  consented: 'Consented to electronic signature',
  signed: 'Signature completed',
  declined: 'Declined to sign',
  reminder_sent: 'Reminder sent',
  voided: 'Envelope voided',
  expired: 'Signing link expired',
  edited: 'Contract terms edited',
  field_signed: 'Signed a field',
  signature_remembered: 'Chose to reuse signature for remaining fields',
  delegated: 'Signing forwarded to another signer',
};

function eventLine(e: ContractAuditEvent, fieldLabelById: Map<string, string>): string {
  if (e.eventType === 'delegated' && e.detail) return e.detail;
  if (e.eventType === 'field_signed' && e.fieldId) {
    const label = fieldLabelById.get(e.fieldId);
    if (label) return `Signed "${label}"`;
  }
  return EVENT_LABELS[e.eventType] ?? e.eventType;
}

export function VerifyContractPage() {
  const { instanceId } = useParams<{ instanceId: string }>();
  const { data, isLoading, isError } = usePublicContractVerification(instanceId);

  return (
    <div className="min-h-screen bg-surface-2">
      <div className="border-b border-border bg-white px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#0B1E33]" />
          <span className="text-[14px] font-bold text-[#0B1E33]">Bluebird Acquisition</span>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-8">
        {isLoading && (
          <div className="flex h-60 items-center justify-center text-text-3">
            <Loader2 size={22} className="animate-spin" />
          </div>
        )}

        {!isLoading && (isError || !data) && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border-2 bg-white py-16 text-center">
            <FileX size={28} className="text-text-3" />
            <p className="text-[14px] font-medium text-text">This document can't be verified</p>
            <p className="max-w-sm text-[12.5px] text-text-3">
              Either this link is wrong, or the document hasn't been fully completed yet — a verification record only
              exists once every required party has signed.
            </p>
          </div>
        )}

        {!isLoading && data && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success-dim px-4 py-3 text-success">
              <ShieldCheck size={18} className="shrink-0" />
              <p className="text-[13px] font-medium">Completed — all required parties have signed</p>
            </div>

            <VerifyCard title="Document Overview">
              <KeyValue label="Document" value={data.name} />
              {data.propertyAddress && <KeyValue label="Property" value={data.propertyAddress} />}
              <KeyValue label="Completed" value={data.completedAt ? formatDateTime(data.completedAt) : '—'} />
              {data.startingDocHash && <KeyValue label="Starting Document Hash (SHA-256)" value={data.startingDocHash} mono />}
              {data.finalDocHash && <KeyValue label="Final Document Hash (SHA-256)" value={data.finalDocHash} mono />}
            </VerifyCard>

            <VerifyCard title="Signers">
              <div className="space-y-4">
                {data.parties.map((p) => {
                  const role = roleLabel(p.role, data.templateType ?? 'contract', data.templatePartyRoles);
                  return (
                    <div key={p.id}>
                      <div className="text-[13px] font-semibold text-text">
                        {role} — {p.name}
                      </div>
                      {p.delegatedFromName && (
                        <p className="mt-0.5 text-[11.5px] text-text-3">
                          Originally sent to {p.delegatedFromName}, who reviewed it and forwarded it to the signer above.
                        </p>
                      )}
                      {p.signedAt ? (
                        <p className="mt-0.5 text-[12px] text-success">Signed electronically — {formatDateTime(p.signedAt)}</p>
                      ) : (
                        <p className="mt-0.5 text-[12px] text-text-3">Not signed</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </VerifyCard>

            <VerifyCard title="Complete Event Timeline">
              <EventTimeline data={data} />
            </VerifyCard>

            <p className="pb-6 text-center text-[11px] text-text-3">
              This page is the detailed audit trail behind the printed Certificate of Completion. Bluebird Acquisition
              will never ask for bank details or payment through this page.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function VerifyCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border-2 bg-white p-4">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-3">{title}</div>
      {children}
    </div>
  );
}

function KeyValue({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-border-2 py-2 first:border-t-0 first:pt-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <span className="text-[12px] text-text-3">{label}</span>
      <span className={`text-[12.5px] font-medium text-text ${mono ? 'break-all font-mono text-[10.5px]' : ''}`}>{value}</span>
    </div>
  );
}

function EventTimeline({ data }: { data: NonNullable<ReturnType<typeof usePublicContractVerification>['data']> }) {
  const partyById = new Map(data.parties.map((p) => [p.id, p]));
  const fieldLabelById = new Map(data.templateFields.map((f) => [f.id, f.label]));

  if (data.events.length === 0) {
    return <p className="text-[12.5px] text-text-3">No events were recorded for this document.</p>;
  }

  return (
    <div className="space-y-3">
      {data.events.map((e) => {
        const party = e.partyId ? partyById.get(e.partyId) : undefined;
        const who = party ? `${roleLabel(party.role, data.templateType ?? 'contract', data.templatePartyRoles)} — ${partyNameAtEvent(party, e.createdAt)}` : 'System';
        return (
          <div key={e.id} className="border-t border-border-2 pt-3 first:border-t-0 first:pt-0">
            <div className="text-[12.5px] font-semibold text-text">{who}</div>
            <div className="text-[12.5px] text-text-2">
              {eventLine(e, fieldLabelById)} — {formatDateTime(e.createdAt)}
            </div>
            {e.ipAddress && <div className="mt-0.5 text-[10.5px] text-text-3">IP Address: {e.ipAddress}</div>}
            {e.userAgent && <div className="text-[10.5px] text-text-3">Device: {e.userAgent}</div>}
          </div>
        );
      })}
    </div>
  );
}
