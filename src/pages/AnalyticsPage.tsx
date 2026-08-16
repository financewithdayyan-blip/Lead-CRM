import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useOrgLeads, useOrgStageChanges, computeSourcePerformance, computeStageTiming } from '@/hooks/useAnalytics';
import { useContractInstances } from '@/hooks/useContractInstances';
import { RANGE_OPTIONS, rangeCutoff, type DateRange } from '@/lib/dateRange';
import { SourcePerformanceList } from '@/components/analytics/SourcePerformanceList';
import { StageTimingChart } from '@/components/analytics/StageTimingChart';

export function AnalyticsPage() {
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const { data: leads, isLoading: leadsLoading } = useOrgLeads();
  const { data: stageChanges, isLoading: stageChangesLoading } = useOrgStageChanges();
  const { data: contracts = [], isLoading: contractsLoading } = useContractInstances();

  const isLoading = leadsLoading || stageChangesLoading || contractsLoading;
  const cutoff = rangeCutoff(dateRange);

  const rangedLeads = useMemo(
    () => (cutoff ? leads.filter((l) => new Date(l.createdAt) >= cutoff) : leads),
    [leads, cutoff],
  );

  const sourceRows = useMemo(() => computeSourcePerformance(rangedLeads, contracts), [rangedLeads, contracts]);
  const stageTiming = useMemo(() => computeStageTiming(leads, stageChanges, contracts, cutoff), [leads, stageChanges, contracts, cutoff]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">Analytics</h1>
          <p className="text-sm text-text-3">Where leads come from, and how long deals take to close.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border-2 bg-surface-3 p-0.5">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.key}
              onClick={() => setDateRange(r.key)}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                dateRange === r.key ? 'bg-surface text-text shadow-sm' : 'text-text-3 hover:text-text-2'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="card flex h-64 items-center justify-center text-text-3">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">Lead Source Performance</h3>
              <span className="text-[11px] text-text-3">leads added in this range, by source</span>
            </div>
            <SourcePerformanceList rows={sourceRows} />
          </div>

          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">Stage Timing</h3>
              <span className="text-[11px] text-text-3">avg. time spent in each stage before moving on</span>
            </div>
            <StageTimingChart result={stageTiming} />
          </div>
        </div>
      )}
    </div>
  );
}
