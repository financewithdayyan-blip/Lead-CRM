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

/** Half-height floor, in SVG units — keeps a near-empty final stage a visible
 * sliver instead of collapsing the shape to a hairline. */
const MIN_HALF = 4;
const MAX_HALF = 54;
const VIEW_W = 600;
const VIEW_H = 140;
const CY = VIEW_H / 2;

/**
 * The single visual that ties SMS outreach and calling into one pipeline: a
 * continuous funnel silhouette that tapers stage to stage, the shape's own
 * width doing the same job the old discrete bars did, plus the actual
 * headcount and cumulative conversion rate at each waist. Negotiation sits
 * downstream of Qualified because that's the actual rule now (calls happen
 * to qualified leads, not cold ones).
 *
 * Each stage is cumulative by *current* stage — "Replied" counts every lead
 * presently sitting at Replied or a later active stage (Qualified,
 * Negotiation, Contract, etc.), the same live population the Kanban board
 * shows summed across its columns. A lead that reached a stage and then went
 * Dead/Declined, On Hold, or Other no longer counts anywhere here — that
 * population is broken out in the off-pipeline chips below instead.
 *
 * `stages` should start at the first real funnel step (Contacted), not the
 * whole lead universe — a "Cold" stage scaled against thousands of never-
 * contacted leads dwarfs every real stage down to the same minimum-width
 * floor, which is what made the first version of this chart unreadable.
 * Total/cold counts belong in `totalLeads`/`coldCount` instead, shown as
 * plain context above the funnel rather than distorting its scale.
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
  const first = stages[0];
  const lastStage = stages[stages.length - 1];
  const maxCount = Math.max(first?.count ?? 0, 1);
  const overallRate = first && first.count > 0 ? (lastStage.count / first.count) * 100 : 0;

  const points = stages.map((s, i) => ({
    x: (i / Math.max(stages.length - 1, 1)) * VIEW_W,
    half: Math.max((s.count / maxCount) * MAX_HALF, s.count > 0 ? MIN_HALF : 0),
    pct: first && first.count > 0 ? Math.round((s.count / first.count) * 100) : 0,
  }));

  return (
    <div>
      {/* ── Headline: the number this card leads with ─────────────────── */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <div className="font-sans text-[32px] font-bold leading-none text-text">
            {overallRate.toFixed(1)}<span className="text-[20px] text-text-2">%</span>
          </div>
          <div className="mt-1.5 text-[12px] text-text-2">
            Overall {first?.label.toLowerCase()} &rarr; {lastStage?.label.toLowerCase()} rate
          </div>
        </div>
        <div className="text-right text-[12px] text-text-3">
          <div><span className="font-mono font-semibold tabular-nums text-text-2">{lastStage?.count.toLocaleString()}</span> of {first?.count.toLocaleString()} reached {lastStage?.label}</div>
          <div className="mt-0.5">{totalLeads.toLocaleString()} total leads &middot; {coldCount.toLocaleString()} still cold</div>
        </div>
      </div>

      {/* ── The funnel shape itself ─────────────────────────────────────── */}
      {/* mx-10 so the first/last stage's label and pill — centred exactly on
          the 0%/100% edge of the shape — have room either side instead of
          spilling past the card's own padding. */}
      <div className="relative mx-10 mt-5" style={{ height: 136 }}>
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" className="absolute inset-0 h-[92px] w-full overflow-visible">
          <defs>
            <linearGradient id="funnelFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#eef2f6" />
              <stop offset="100%" stopColor="#e1e7ee" />
            </linearGradient>
          </defs>
          {points.slice(0, -1).map((p0, i) => {
            const p1 = points[i + 1];
            const midX = (p0.x + p1.x) / 2;
            const d = `M ${p0.x} ${CY - p0.half} C ${midX} ${CY - p0.half} ${midX} ${CY - p1.half} ${p1.x} ${CY - p1.half} L ${p1.x} ${CY + p1.half} C ${midX} ${CY + p1.half} ${midX} ${CY + p0.half} ${p0.x} ${CY + p0.half} Z`;
            const s0 = stages[i];
            const s1 = stages[i + 1];
            const dropPct = s0.count > 0 ? Math.round((1 - s1.count / s0.count) * 100) : 0;
            return (
              <path key={s1.key} d={d} fill="url(#funnelFill)" className="transition-opacity hover:opacity-80">
                <title>{`${s1.label}: ${s1.count.toLocaleString()} (${dropPct}% drop-off from ${s0.label})`}</title>
              </path>
            );
          })}
        </svg>

        {/* Pills — centred on each waist, in the same fractional x as the SVG points. */}
        <div className="absolute inset-x-0 top-0 h-[92px]">
          {points.map((p, i) => {
            const isLast = i === points.length - 1;
            return (
              <div
                key={stages[i].key}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${(p.x / VIEW_W) * 100}%` }}
              >
                <div
                  className={
                    isLast
                      ? 'rounded-full bg-accent px-2.5 py-1 text-[12.5px] font-bold text-text shadow-sm'
                      : 'rounded-full border border-border-2 bg-surface px-2.5 py-1 text-[12.5px] font-semibold text-text-2 shadow-sm'
                  }
                >
                  {p.pct}%
                </div>
              </div>
            );
          })}
        </div>

        {/* Labels — stage name + raw count, wrapping is fine, each has its own
            column. Width is a fraction of the gap between adjacent points,
            not a fixed px — a fixed width fit on a wide desktop card but on
            a narrow mobile one the points sit closer together than 84px and
            neighbouring labels overlapped into unreadable mush. */}
        <div className="absolute inset-x-0 top-[100px] h-9">
          {points.map((p, i) => (
            <div
              key={stages[i].key}
              className="absolute top-0 -translate-x-1/2 text-center"
              style={{ left: `${(p.x / VIEW_W) * 100}%`, width: `${90 / Math.max(points.length - 1, 1)}%` }}
            >
              <div className="text-[10.5px] font-semibold leading-tight text-text-2">{stages[i].label}</div>
              <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-text-3">{stages[i].count.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>

      {offFunnel.length > 0 && (
        <div className="mt-9 flex flex-wrap gap-2 border-t border-border pt-3">
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
