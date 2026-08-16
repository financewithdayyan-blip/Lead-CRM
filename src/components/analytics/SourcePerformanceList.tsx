import type { SourcePerformanceRow } from '@/hooks/useAnalytics';

/**
 * Ranked bars, same visual language as PipelineFunnel — width by lead count,
 * with a signed-conversion badge per row instead of a taper/drop-off chain
 * (these rows aren't sequential stages, so a funnel shape doesn't apply).
 */
export function SourcePerformanceList({ rows }: { rows: SourcePerformanceRow[] }) {
  const max = Math.max(...rows.map((r) => r.leadCount), 1);
  const totalLeads = rows.reduce((sum, r) => sum + r.leadCount, 0);
  const unknown = rows.find((r) => r.key === '(unknown)');
  const unknownShare = totalLeads > 0 && unknown ? unknown.leadCount / totalLeads : 0;

  if (rows.length === 0) {
    return <div className="text-[13px] text-text-3">No leads in this range yet.</div>;
  }

  return (
    <div>
      {unknownShare > 0.5 && (
        <p className="mb-3 rounded-md border border-border-2 bg-surface-3 px-3 py-2 text-[11.5px] text-text-3">
          Most leads here have no source on record — that's now required when adding or importing leads, so this
          fills in going forward.
        </p>
      )}
      <div className="space-y-1.5">
        {rows.map((r) => {
          const pct = (r.leadCount / max) * 100;
          const conversionPct = r.leadCount > 0 ? Math.round((r.contractsSignedCount / r.leadCount) * 100) : 0;
          return (
            <div key={r.key} className="group flex items-center gap-3">
              <div className="w-32 shrink-0 truncate text-right text-[12.5px] font-semibold text-text-2" title={r.label}>
                {r.label}
              </div>
              <div className="h-9 flex-1 rounded-lg bg-surface-3">
                <div
                  className="flex h-9 items-center justify-end rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-white shadow-sm transition-all duration-300 group-hover:brightness-110"
                  style={{ width: `${Math.max(pct, 8)}%` }}
                >
                  {r.leadCount.toLocaleString()}
                </div>
              </div>
              <div className="w-40 shrink-0 text-[11.5px] text-text-3">
                {r.qualifiedCount.toLocaleString()} qualified · {r.contractsSentCount.toLocaleString()} sent ·{' '}
                <span className={r.contractsSignedCount > 0 ? 'font-semibold text-emerald-600' : ''}>
                  {r.contractsSignedCount.toLocaleString()} signed ({conversionPct}%)
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
