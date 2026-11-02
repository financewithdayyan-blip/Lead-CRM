import { LeadCompsSection } from './LeadCompsSection';
import { MAO_ARV_PCT, MAO_REPAIR_MULTIPLIER, MAO_MIN_FEE } from './RepairEstimateSection';
import { RehabCostEstimator } from './RehabCostEstimator';
import { formatCurrency } from '@/lib/utils';
import type { Lead } from '@/types/domain';

/** Visual breakdown of the MAO formula — shows the real breakdown behind
 * the number (as one scale from $0 to ARV, same bar-with-tick-marks
 * language as the Overview tab's "Where the deal stands" card) instead of
 * a single inline line of text. The seller's asking price (lead.askingPrice,
 * the same real field that card uses) is plotted on the same scale so it's
 * clear at a glance whether the ask leaves room under the max offer or sits
 * over it. Repairs comes from lead.estRepairs — the same field the Rehab
 * Cost Estimator's "Use as Est. Repairs" button writes to, and the one the
 * Property tab / Overview specs grid already show — not the itemized
 * lead_repairs table, which no longer has an editing UI anywhere on this
 * page since the Repair Estimate card was removed. */
function MaoWaterfallCard({ lead }: { lead: Lead }) {
  const totalRepairs = lead.estRepairs ?? 0;

  if (lead.arv == null) {
    return (
      <div className="card text-[13px] text-text-3">Set an ARV on Overview to see how your Max Allowable Offer is calculated.</div>
    );
  }

  const arv = lead.arv;
  const repairsCost = MAO_REPAIR_MULTIPLIER * totalRepairs;
  const fee = MAO_MIN_FEE;
  const mao = arv * MAO_ARV_PCT - repairsCost - fee;
  const asking = lead.askingPrice;

  // Segments read left to right as "building back up" from the max offer to
  // the full ARV by adding back everything that was subtracted. Scale
  // stretches past ARV when the asking price is higher, so an over-ask is
  // never clipped off the edge. Each a genuinely different hue (not shades
  // of the same red) so they're distinguishable at a glance — red is kept
  // free for the asking-price marker alone, which is the one thing on this
  // card that's actually a warning when it lights up.
  const scaleMax = Math.max(arv, asking ?? 0, 1);
  const pct = (v: number) => Math.max(0, Math.min(100, (v / scaleMax) * 100));
  const segments = [
    { label: 'MAO', from: 0, to: mao, color: '#10b981' },
    { label: 'Fee', from: mao, to: mao + fee, color: '#8b5cf6' },
    { label: 'Rehab ×2', from: mao + fee, to: mao + fee + repairsCost, color: '#f59e0b' },
    { label: 'Holding & closing', from: mao + fee + repairsCost, to: arv, color: '#38bdf8' },
  ];
  const askingColor = asking == null ? null : asking > mao ? '#ef4444' : asking < mao ? '#3dd6b5' : '#10b981';

  // Whichever of MAO/asking sits further left on the scale gets its label
  // right-aligned so the text ends at the tick (extends leftward); the other
  // gets left-aligned so it starts at the tick (extends rightward) — same
  // convention the mockup's own "Your offer"/"She's asking" callouts use,
  // keeps the two labels from colliding into each other above the bar.
  const maoPct = pct(mao);
  const askingPct = asking != null ? pct(asking) : null;
  const maoEndsAtTick = askingPct != null && maoPct <= askingPct;

  return (
    <div className="card">
      {/* pt-9 reserves the floating labels' own height above the bar — a
       *  margin-top on the bar itself would collapse through this wrapper
       *  (no padding/border of its own to stop it) and land the bar right
       *  on top of the labels instead of below them. */}
      <div className="relative pt-9">
        <div
          className="absolute top-0 whitespace-nowrap"
          style={
            askingPct == null
              ? { left: `${maoPct}%`, transform: 'translateX(-50%)', textAlign: 'center' }
              : maoEndsAtTick
                ? { left: `${maoPct}%`, transform: 'translateX(-100%)', paddingRight: 8, textAlign: 'right' }
                : { left: `${maoPct}%`, paddingLeft: 8, textAlign: 'left' }
          }
        >
          <div className="text-[11.5px] font-semibold text-success">MAO</div>
          <div className="font-mono text-[15px] font-extrabold text-text">{formatCurrency(mao)}</div>
        </div>
        {askingPct != null && askingColor && (
          <div
            className="absolute top-0 whitespace-nowrap"
            style={
              maoEndsAtTick
                ? { left: `${askingPct}%`, paddingLeft: 8, textAlign: 'left' }
                : { left: `${askingPct}%`, transform: 'translateX(-100%)', paddingRight: 8, textAlign: 'right' }
            }
          >
            <div className="text-[11.5px] font-semibold" style={{ color: askingColor }}>
              Seller asking
            </div>
            <div className="font-mono text-[15px] font-extrabold text-text">{formatCurrency(asking)}</div>
          </div>
        )}

        <div className="relative h-2.5 rounded-full bg-surface-3">
          {segments.map((s) => (
            <div
              key={s.label}
              className="absolute inset-y-0 rounded-full"
              style={{ left: `${pct(s.from)}%`, width: `${pct(s.to) - pct(s.from)}%`, background: s.color }}
            />
          ))}
          <div className="absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-success" style={{ left: `${maoPct}%` }} />
          {askingPct != null && askingColor && (
            <div className="absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full" style={{ left: `${askingPct}%`, background: askingColor }} />
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[11px] text-text-3">$0</span>
          <div className="text-right">
            <div className="text-[11px] text-text-3">ARV</div>
            <div className="font-mono text-[13px] font-bold text-text">{formatCurrency(arv)}</div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-3 text-[11.5px] text-text-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: '#94a3b8' }} />
          ARV <b className="font-mono text-text">{formatCurrency(arv)}</b>
        </span>
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
            {s.label} <b className="font-mono text-text">{formatCurrency(s.to - s.from)}</b>
          </span>
        ))}
        {asking != null && askingColor && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: askingColor }} />
            Seller asking <b className="font-mono text-text">{formatCurrency(asking)}</b>
          </span>
        )}
      </div>
    </div>
  );
}

export function UnderwritingTab({ lead }: { lead: Lead }) {
  return (
    <div className="space-y-5">
      <MaoWaterfallCard lead={lead} />
      <RehabCostEstimator lead={lead} />
      <LeadCompsSection lead={lead} />
    </div>
  );
}
