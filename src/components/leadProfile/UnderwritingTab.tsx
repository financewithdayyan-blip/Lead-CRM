import type { CSSProperties } from 'react';
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
 * page since the Repair Estimate card was removed. The fee deduction uses
 * the real lead.assignmentFee (the Overview stat card of the same name)
 * once one's been entered — MAO_MIN_FEE is only a floor for before that
 * negotiated number is known, not a fee that stays $10k forever regardless
 * of what the deal actually pays. */
function MaoWaterfallCard({ lead }: { lead: Lead }) {
  const totalRepairs = lead.estRepairs ?? 0;

  if (lead.arv == null) {
    return (
      <div className="card text-[13px] text-text-3">Set an ARV on Overview to see how your Max Allowable Offer is calculated.</div>
    );
  }

  const arv = lead.arv;
  const repairsCost = MAO_REPAIR_MULTIPLIER * totalRepairs;
  const fee = lead.assignmentFee ?? MAO_MIN_FEE;
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
    { label: 'Wholesale Fee', from: mao, to: mao + fee, color: '#8b5cf6' },
    { label: 'Rehab ×2', from: mao + fee, to: mao + fee + repairsCost, color: '#f59e0b' },
    { label: 'Holding & closing', from: mao + fee + repairsCost, to: arv, color: '#38bdf8' },
  ];
  const askingColor = asking == null ? null : asking > mao ? '#ef4444' : asking < mao ? '#3dd6b5' : '#10b981';
  const maoPct = pct(mao);
  const askingPct = asking != null ? pct(asking) : null;

  // Every amount gets its own floating label above the bar instead of being
  // legend-only text below it — a point (MAO, Seller asking) labels at its
  // own tick; a span (Fee, Rehab, Holding & closing) labels at its span's
  // midpoint. Sorted left to right, then alternated onto two stacked rows so
  // two labels that land close together (a thin Fee sliver next to MAO, say)
  // don't overlap — a label never knows what's next to it, only its own
  // row, so alternating by sort order is what actually keeps neighbors apart.
  type LabelItem = { key: string; pos: number; title: string; amount: number; color: string };
  const labelItems: LabelItem[] = [
    { key: 'mao', pos: maoPct, title: 'MAO', amount: mao, color: '#10b981' },
    { key: 'fee', pos: (pct(mao) + pct(mao + fee)) / 2, title: 'Wholesale Fee', amount: fee, color: '#8b5cf6' },
    { key: 'rehab', pos: (pct(mao + fee) + pct(mao + fee + repairsCost)) / 2, title: 'Rehab ×2', amount: repairsCost, color: '#f59e0b' },
    { key: 'holding', pos: (pct(mao + fee + repairsCost) + pct(arv)) / 2, title: 'Holding & closing', amount: arv - (mao + fee + repairsCost), color: '#38bdf8' },
  ];
  if (askingPct != null && askingColor) {
    labelItems.push({ key: 'asking', pos: askingPct, title: 'Seller asking', amount: asking!, color: askingColor });
  }
  labelItems.sort((a, b) => a.pos - b.pos);
  const ROW_HEIGHT = 34;

  function labelStyle(pos: number): CSSProperties {
    if (pos <= 8) return { left: '0%' };
    if (pos >= 92) return { left: '100%', transform: 'translateX(-100%)' };
    return { left: `${pos}%`, transform: 'translateX(-50%)' };
  }

  return (
    <div className="card">
      {/* Padding (not margin) reserves the floating labels' own height above
       *  the bar — a margin-top on the bar itself would collapse through
       *  this wrapper (no padding/border of its own to stop it) and land
       *  the bar right on top of the labels instead of below them. */}
      <div className="relative" style={{ paddingTop: ROW_HEIGHT * 2 + 4 }}>
        {labelItems.map((item, i) => (
          <div
            key={item.key}
            className="absolute whitespace-nowrap"
            style={{ top: (i % 2) * ROW_HEIGHT, ...labelStyle(item.pos) }}
          >
            <div className="text-[11px] font-semibold" style={{ color: item.color }}>
              {item.title}
            </div>
            <div className="font-mono text-[14px] font-extrabold text-text">{formatCurrency(item.amount)}</div>
          </div>
        ))}

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

      {asking == null && (
        <div className="mt-3 border-t border-border pt-3 text-[12px] text-text-3">
          Set an asking price on Overview to see it plotted against your MAO here.
        </div>
      )}
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
