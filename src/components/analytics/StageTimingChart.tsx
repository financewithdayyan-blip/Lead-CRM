import { STAGE_CONFIG, STAGE_ORDER, type LeadStage } from '@/types/domain';
import type { StageTimingResult } from '@/hooks/useAnalytics';

function formatDays(days: number): string {
  if (days < 1) return `${Math.round(days * 24)}h`;
  return `${days.toFixed(1)}d`;
}

export function StageTimingChart({ result }: { result: StageTimingResult }) {
  const byStage = new Map(result.stages.map((s) => [s.stage, s]));
  const rows = STAGE_ORDER.filter((s) => byStage.has(s)).map((s) => byStage.get(s)!);
  const max = Math.max(...rows.map((r) => r.avgDays), 1);

  return (
    <div>
      <div className="mb-4 flex items-center gap-4 rounded-md border border-border-2 bg-surface-3 px-3 py-2.5">
        <div className="text-[11px] uppercase tracking-wide text-text-3">Avg. new lead → signed contract</div>
        <div className="font-mono text-lg font-bold text-text">
          {result.avgDaysToSigned !== null ? formatDays(result.avgDaysToSigned) : '—'}
        </div>
        {result.avgDaysToSigned !== null && (
          <div className="text-[11px] text-text-3">across {result.signedSampleSize.toLocaleString()} signed contract{result.signedSampleSize !== 1 ? 's' : ''}</div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="text-[13px] text-text-3">Not enough completed stage transitions in this range yet.</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const cfg = STAGE_CONFIG[r.stage as LeadStage];
            const pct = (r.avgDays / max) * 100;
            return (
              <div key={r.stage} className="group flex items-center gap-3">
                <div className="w-32 shrink-0 truncate text-right text-[12.5px] font-semibold text-text-2">{cfg?.label ?? r.stage}</div>
                <div className="h-9 flex-1 rounded-lg bg-surface-3">
                  <div
                    className="flex h-9 items-center justify-end rounded-lg px-3 text-[12.5px] font-semibold text-white shadow-sm transition-all duration-300 group-hover:brightness-110"
                    style={{ width: `${Math.max(pct, 8)}%`, background: cfg?.color ?? '#94a3b8' }}
                  >
                    {formatDays(r.avgDays)}
                  </div>
                </div>
                <div className="w-24 shrink-0 text-[11.5px] text-text-3">{r.sampleSize.toLocaleString()} leads</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
