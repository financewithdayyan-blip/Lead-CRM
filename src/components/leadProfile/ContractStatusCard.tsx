import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ExternalLink, ListChecks } from 'lucide-react';
import { useContractInstancesForLead, useContractAuditEvents, type ContractAuditEvent } from '@/hooks/useContractInstances';
import { roleLabel } from '@/hooks/useDocTemplates';
import { CreateContractButton } from './CreateContractButton';
import { ContractPreviewModal } from '@/components/bluedocs/ContractPreviewModal';
import { formatDateTime } from '@/lib/utils';
import type { Lead } from '@/types/domain';

const TERMINAL_LABEL: Record<string, string> = {
  voided: 'Voided',
  declined: 'Declined',
  expired: 'Expired',
};

// Condensed labels for the per-party timeline below — a subset of
// ContractPreviewModal's own EVENT_ACTION_TEXT, past-tense as a completed
// step rather than a sentence fragment. field_signed/signature_remembered/
// edited are left out here (too noisy for a condensed card) but still show
// up in the full Audit Trail via "View full activity" below.
const EVENT_STEP_LABELS: Partial<Record<ContractAuditEvent['eventType'], string>> = {
  sent: 'Sent for signature',
  viewed: 'Opened the signing link',
  consented: 'Consented to sign electronically',
  declined: 'Declined to sign',
  reminder_sent: 'Reminder sent',
};

/** Chronological events for one party, collapsed to one line per event type
 * — except 'delegated', which always gets its own line (using its `detail`
 * text, e.g. "Jane Smith forwarded signing to John Doe") and resets the
 * dedupe so the next chapter (the actual signer's own sent/viewed/signed)
 * renders in full even though the party row is the same one reused. */
function collapsePartyEvents(events: ContractAuditEvent[]): ContractAuditEvent[] {
  const seen = new Set<string>();
  const out: ContractAuditEvent[] = [];
  for (const e of events) {
    if (e.eventType === 'delegated') {
      out.push(e);
      seen.clear();
      continue;
    }
    if ((!EVENT_STEP_LABELS[e.eventType] && e.eventType !== 'signed') || seen.has(e.eventType)) continue;
    seen.add(e.eventType);
    out.push(e);
  }
  return out;
}

export function ContractStatusCard({ lead }: { lead: Lead }) {
  const { data: instances = [], isLoading } = useContractInstancesForLead(lead.id);
  const [showActivity, setShowActivity] = useState(false);

  const active = instances.find((i) => !(i.status in TERMINAL_LABEL)) ?? instances[0];
  const priorCount = instances.length - (active ? 1 : 0);

  const { data: events = [] } = useContractAuditEvents(active?.id);
  // Every party's own chapter in signing order — not just the seller's, so
  // "our turn to sign" / "Countersigned by you" (the buyer/"Us" party — the
  // same role create-contract-instance always sends on our behalf) shows up
  // here too instead of this card silently jumping from the seller's last
  // step straight to "Fully executed".
  const sortedParties = useMemo(
    () => (active?.parties ?? []).slice().sort((a, b) => a.signOrder - b.signOrder),
    [active],
  );
  const nextParty = sortedParties.find((p) => p.status === 'pending');
  const fullyExecuted = active?.status === 'signed';

  const terminalLabel = active && active.status in TERMINAL_LABEL ? TERMINAL_LABEL[active.status] : null;

  return (
    <>
    <div className="card">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Contract</div>
        {priorCount > 0 && (
          <Link to="/blue-docs" className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
            {priorCount} prior contract{priorCount === 1 ? '' : 's'} <ExternalLink size={11} />
          </Link>
        )}
      </div>

      {isLoading && <div className="mt-3 text-[13px] text-text-3">Loading…</div>}

      {!isLoading && !active && (
        <div className="mt-3">
          <p className="mb-3 text-[13px] text-text-3">No contract started yet.</p>
          <CreateContractButton lead={lead} />
        </div>
      )}

      {active && terminalLabel && (
        <div className="mt-3 space-y-3">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-danger-dim px-2.5 py-1 text-[12.5px] font-medium text-danger">
            {terminalLabel}
          </div>
          <div>
            <CreateContractButton lead={lead} />
          </div>
        </div>
      )}

      {active && !terminalLabel && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={16} className="shrink-0 text-success" />
            <span className="text-[13.5px] font-medium text-text">Drafted</span>
          </div>

          {sortedParties.map((party) =>
            collapsePartyEvents(events.filter((e) => e.partyId === party.id)).map((e) => (
              <div key={e.id} className="flex items-start gap-2.5">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
                <div>
                  <span className="text-[13.5px] font-medium text-text">
                    {e.eventType === 'delegated'
                      ? e.detail
                      : e.eventType === 'signed'
                        ? party.role === 'buyer'
                          ? 'Countersigned by you'
                          : `Signed by ${party.name}`
                        : EVENT_STEP_LABELS[e.eventType]}
                  </span>
                  <div className="text-[11px] text-text-3">{formatDateTime(e.createdAt)}</div>
                </div>
              </div>
            )),
          )}

          {!fullyExecuted && nextParty && (
            <div className="flex items-center gap-2.5">
              <Circle size={16} className="shrink-0 text-text-3" />
              <span className="text-[13.5px] text-text-3">
                {nextParty.role === 'buyer'
                  ? 'Your turn to sign'
                  : `${roleLabel(nextParty.role, active.templateType ?? 'contract', active.templatePartyRoles)}'s turn to sign`}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2.5">
            {fullyExecuted ? <CheckCircle2 size={16} className="shrink-0 text-success" /> : <Circle size={16} className="shrink-0 text-text-3" />}
            <span className={`text-[13.5px] ${fullyExecuted ? 'font-medium text-text' : 'text-text-3'}`}>Fully executed</span>
          </div>

          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            onClick={() => setShowActivity(true)}
          >
            <ListChecks size={12} /> View full activity
          </button>
        </div>
      )}
    </div>
    {showActivity && active && <ContractPreviewModal instance={active} onClose={() => setShowActivity(false)} />}
    </>
  );
}
