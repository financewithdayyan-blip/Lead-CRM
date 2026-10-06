import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { useContractInstancesForLead } from '@/hooks/useContractInstances';

const STEPS = ['Drafted', 'Sent for signature', 'Seller signed', 'Fully executed'];

const TERMINAL_LABEL: Record<string, string> = {
  voided: 'Voided',
  declined: 'Declined',
  expired: 'Expired',
};

export function ContractStatusCard({ leadId }: { leadId: string }) {
  const { data: instances = [], isLoading } = useContractInstancesForLead(leadId);

  const active = instances.find((i) => !(i.status in TERMINAL_LABEL)) ?? instances[0];
  const priorCount = instances.length - (active ? 1 : 0);

  let activeStep = -1;
  let terminalLabel: string | null = null;
  if (active) {
    if (active.status in TERMINAL_LABEL) {
      terminalLabel = TERMINAL_LABEL[active.status];
    } else if (active.status === 'draft') activeStep = 0;
    else if (active.status === 'sent') activeStep = 1;
    else if (active.status === 'partial') {
      activeStep = active.parties.find((p) => p.role === 'seller')?.status === 'signed' ? 2 : 1;
    } else if (active.status === 'signed') activeStep = 3;
  }

  return (
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
        <div className="mt-3 text-[13px] text-text-3">
          No contract started yet.{' '}
          <Link to="/blue-docs" className="font-medium text-primary hover:underline">
            Send one from Blue Docs
          </Link>
          .
        </div>
      )}

      {active && terminalLabel && (
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-danger-dim px-2.5 py-1 text-[12.5px] font-medium text-danger">
          {terminalLabel}
        </div>
      )}

      {active && !terminalLabel && (
        <div className="mt-3 space-y-2">
          {STEPS.map((label, i) => {
            const complete = i <= activeStep;
            return (
              <div key={label} className="flex items-center gap-2.5">
                {complete ? <CheckCircle2 size={16} className="shrink-0 text-success" /> : <Circle size={16} className="shrink-0 text-text-3" />}
                <span className={`text-[13.5px] ${complete ? 'font-medium text-text' : 'text-text-3'}`}>{label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
