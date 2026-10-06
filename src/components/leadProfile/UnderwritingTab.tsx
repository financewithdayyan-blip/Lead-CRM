import { LeadCompsSection } from './LeadCompsSection';
import { RepairEstimateSection } from './RepairEstimateSection';
import type { Lead } from '@/types/domain';

export function UnderwritingTab({ lead }: { lead: Lead }) {
  return (
    <div className="space-y-5">
      <LeadCompsSection lead={lead} />
      <RepairEstimateSection lead={lead} />
    </div>
  );
}
