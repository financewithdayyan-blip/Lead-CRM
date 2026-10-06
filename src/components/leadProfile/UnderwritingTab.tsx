import { Calculator } from 'lucide-react';
import type { Lead } from '@/types/domain';

export function UnderwritingTab({ lead: _lead }: { lead: Lead }) {
  return (
    <div className="card flex flex-col items-center gap-2 py-12 text-center">
      <Calculator size={22} className="text-text-3" />
      <div className="text-[14px] font-medium text-text">Underwriting calculator coming soon</div>
      <p className="max-w-sm text-[12.5px] text-text-3">
        Comps, itemized repairs, and the ARV/buy%/fee calculator for this lead are being built next.
      </p>
    </div>
  );
}
