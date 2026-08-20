export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  color: string;
  hint?: string;
}

export interface OffFunnelBucket {
  label: string;
  count: number;
  color: string;
}

/**
 * The single visual that ties SMS outreach and calling into one pipeline:
 * bars taper as leads drop off, and the callout between bars is the actual
 * drop-off rate from one stage to the next — Negotiation sits downstream of
 * Qualified because that's the actual rule now (calls happen to qualified
 * leads, not cold ones).
 *
 * Each bar is cumulative by *current* stage — "Replied" counts every lead
 * presently sitting at Replied or a later active stage (Qualified,
 * Negotiation, Contract, etc.), the same live population the Kanban board
 * shows summed across its columns. A lead that reached a stage and then
 * went Dead/Declined, On Hold, or Other no longer counts anywhere here —
 * that population is broken out in the off-pipeline chips below instead.
 *
 * `stages` should start at the first real funnel step (Contacted), not the
 * whole lead universe — a "Cold" bar scaled against thousands of never-
 * contacted leads dwarfs every real stage down to the same minimum-width
 * floor, which is what made the first version of this chart unreadable.
 * Total/cold counts belong in `totalLeads`/`coldCount` instead, shown as
 * plain context above the bars rather than distorting their scale.
 */
export function PipelineFunnel({
  stages,
  offFunnel,
  totalLeads,
  coldCount,
}: {
  stages: FunnelStage[];
  offFunnel: OffFunnelBucket[];
  totalLeads: number;
  coldCount: number;
}) {
  const max = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px] text-text-2">
        <span>
          <span className="font-semibold text-text">{totalLeads.toLocaleString()}</span> total leads
        </span>
        <span>
          <span className="font-semibold text-text">{coldCount.toLocaleString()}</span> still cold, not yet contacted
        </span>
      </div>
      <p className="mb-4 text-[11px] text-text-3">
        Each bar is a live headcount — leads currently at that stage or a later active one, same as the Kanban board.
      </p>

      <div className="space-y-1">
        {stages.map((s, i) => {
          const pct = (s.count / max) * 100;
          const prev = stages[i - 1];
          const dropOffPct = prev && prev.count > 0 ? Math.round((1 - s.count / prev.count) * 100) : null;
          return (
            <div key={s.key}>
              {i > 0 && (
                <div className="py-0.5 text-center text-[11px] font-medium text-text-3">
                  {dropOffPct !== null ? `↓ ${dropOffPct}% drop-off` : null}
                </div>
              )}
              <div className="group flex items-center gap-3">
                <div className="w-24 shrink-0 text-right text-[12.5px] font-semibold text-text-2">{s.label}</div>
                <div className="h-10 flex-1 rounded-lg bg-surface-3">
                  <div
                    className="flex h-10 items-center justify-end rounded-lg px-3 text-[13px] font-semibold text-white shadow-sm transition-all duration-300 group-hover:brightness-110"
                    style={{ width: `${Math.max(pct, 6)}%`, background: s.color }}
                    title={s.hint}
                  >
                    {s.count.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {offFunnel.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
          <span className="self-center text-[11px] text-text-3">Off pipeline:</span>
          {offFunnel.map((o) => (
            <div
              key={o.label}
              className="flex items-center gap-1.5 rounded-full border border-border-2 bg-surface-3 px-2.5 py-1 text-[11px] text-text-2"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: o.color }} />
              {o.label}: <span className="font-semibold text-text">{o.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
