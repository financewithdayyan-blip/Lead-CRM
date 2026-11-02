import { useState } from 'react';
import { LeadCompsSection } from './LeadCompsSection';
import { RepairEstimateSection, MAO_ARV_PCT, MAO_REPAIR_MULTIPLIER, MAO_MIN_FEE } from './RepairEstimateSection';
import { useLeadRepairs } from '@/hooks/useLeadRepairs';
import { formatCurrency } from '@/lib/utils';
import type { Lead } from '@/types/domain';

/** Visual breakdown of the exact same MAO formula RepairEstimateSection
 * already computes and lets you apply as the Cash Offer — this card adds
 * nothing new to the math, it just shows the real breakdown behind the
 * number (as one scale from $0 to ARV, same bar-with-tick-marks language
 * as the Overview tab's "Where the deal stands" card) instead of a single
 * inline line of text, plus a what-if preview. The seller's asking price
 * (lead.askingPrice, the same real field that card uses) is plotted on the
 * same scale so it's clear at a glance whether the ask leaves room under
 * the max offer or sits over it.
 * The what-if sliders are exploration only: real ARV lives on the lead
 * (edit it on Overview) and real repairs are the itemized list below, so
 * "using" a hypothetical number here would mean overwriting either with a
 * guess — instead, applying the real ARV already has its own control on
 * Overview, and applying real repairs means editing the actual line items. */
function MaoWaterfallCard({ lead }: { lead: Lead }) {
  const { data: repairs = [] } = useLeadRepairs(lead.id);
  const totalRepairs = repairs.reduce((sum, r) => sum + r.cost, 0);
  const [whatIfArv, setWhatIfArv] = useState<number | null>(null);
  const [whatIfRepairs, setWhatIfRepairs] = useState<number | null>(null);

  if (lead.arv == null) {
    return (
      <div className="card text-[13px] text-text-3">Set an ARV on Overview to see how your Max Allowable Offer is calculated.</div>
    );
  }

  const arv = lead.arv;
  const holding = arv * (1 - MAO_ARV_PCT);
  const repairsCost = MAO_REPAIR_MULTIPLIER * totalRepairs;
  const fee = MAO_MIN_FEE;
  const mao = arv * MAO_ARV_PCT - repairsCost - fee;
  const asking = lead.askingPrice;

  // Segments read left to right as "building back up" from the max offer to
  // the full ARV by adding back everything that was subtracted — mirrors the
  // formula sentence above it. Scale stretches past ARV when the asking
  // price is higher, so an over-ask is never clipped off the edge.
  const scaleMax = Math.max(arv, asking ?? 0, 1);
  const pct = (v: number) => Math.max(0, Math.min(100, (v / scaleMax) * 100));
  const segments = [
    { label: 'Max offer', from: 0, to: mao, color: '#10b981' },
    { label: 'Fee', from: mao, to: mao + fee, color: '#ef444499' },
    { label: 'Repairs ×2', from: mao + fee, to: mao + fee + repairsCost, color: '#ef444466' },
    { label: 'Holding & closing', from: mao + fee + repairsCost, to: arv, color: '#ef444433' },
  ];
  const askingColor = asking == null ? null : asking > mao ? '#ff6b6b' : asking < mao ? '#3dd6b5' : '#10b981';

  const previewArv = whatIfArv ?? arv;
  const previewRepairs = whatIfRepairs ?? totalRepairs;
  const previewMao = previewArv * MAO_ARV_PCT - MAO_REPAIR_MULTIPLIER * previewRepairs - MAO_MIN_FEE;
  const isExploring = whatIfArv !== null || whatIfRepairs !== null;

  return (
    <div className="card">
      <div className="border-b border-border pb-2.5">
        <div className="text-[15px] font-semibold text-text">How we got to {formatCurrency(mao)}</div>
        <div className="text-[12px] text-text-3">ARV × 90%, minus repairs twice, minus our $10k fee</div>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-text-2">
        <b className="font-mono text-text">{formatCurrency(arv)}</b> ARV
        <span className="text-text-3"> − </span>
        <span className="font-mono">{formatCurrency(holding)}</span> holding &amp; closing (10%)
        <span className="text-text-3"> − </span>
        <span className="font-mono">{formatCurrency(repairsCost)}</span> repairs ×2
        <span className="text-text-3"> − </span>
        <span className="font-mono">{formatCurrency(fee)}</span> fee
        <span className="text-text-3"> = </span>
        <b className="font-mono text-success">{formatCurrency(mao)}</b> max offer
      </p>

      <div className="relative mt-5 h-2.5 rounded-full bg-surface-3">
        {segments.map((s) => (
          <div
            key={s.label}
            className="absolute inset-y-0 rounded-full"
            style={{ left: `${pct(s.from)}%`, width: `${pct(s.to) - pct(s.from)}%`, background: s.color }}
          />
        ))}
        <div className="absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-success" style={{ left: `${pct(mao)}%` }} />
        {asking != null && askingColor && (
          <div className="absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full" style={{ left: `${pct(asking)}%`, background: askingColor }} />
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-text-3">
        <span>$0</span>
        <span className="font-mono">ARV {formatCurrency(arv)}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-text-2">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        {asking != null && askingColor && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: askingColor }} />
            Seller asking
          </span>
        )}
      </div>

      {asking != null ? (
        <div className="mt-2 text-[12.5px] font-medium" style={{ color: askingColor ?? undefined }}>
          Seller asking <span className="font-mono">{formatCurrency(asking)}</span>
          {asking === mao
            ? ' — matches your max offer exactly.'
            : asking > mao
              ? ` — ${formatCurrency(asking - mao)} over your max offer.`
              : ` — ${formatCurrency(mao - asking)} of room under your max offer.`}
        </div>
      ) : (
        <div className="mt-2 text-[12.5px] text-text-3">Set an asking price on Overview to see it against your max offer.</div>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">What if</div>
        <p className="mt-1 text-[11.5px] text-text-3">
          Drag to see how the max offer moves — nothing saves until you edit the real ARV or repair items.
        </p>
        <div className="mt-2.5 grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
          <label className="text-[12px] text-text-2">
            <div className="flex items-center justify-between">
              <span>ARV</span>
              <span className="font-mono font-semibold text-text">{formatCurrency(previewArv)}</span>
            </div>
            <input
              type="range"
              min={Math.round(arv * 0.5)}
              max={Math.max(Math.round(arv * 1.5), arv + 50000)}
              step={1000}
              value={previewArv}
              onChange={(e) => setWhatIfArv(Number(e.target.value))}
              className="mt-1.5 w-full accent-primary"
            />
          </label>
          <label className="text-[12px] text-text-2">
            <div className="flex items-center justify-between">
              <span>Repairs</span>
              <span className="font-mono font-semibold text-text">{formatCurrency(previewRepairs)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(Math.round(totalRepairs * 2), 50000)}
              step={500}
              value={previewRepairs}
              onChange={(e) => setWhatIfRepairs(Number(e.target.value))}
              className="mt-1.5 w-full accent-primary"
            />
          </label>
        </div>
        {isExploring && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-3 px-3 py-2">
            <div className="text-[12.5px] text-text-2">
              Max offer would be <span className="font-mono font-semibold text-text">{formatCurrency(previewMao)}</span>
            </div>
            <button
              type="button"
              className="text-[11.5px] font-medium text-text-3 hover:text-primary"
              onClick={() => {
                setWhatIfArv(null);
                setWhatIfRepairs(null);
              }}
            >
              Reset
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function UnderwritingTab({ lead }: { lead: Lead }) {
  return (
    <div className="space-y-5">
      <MaoWaterfallCard lead={lead} />
      <LeadCompsSection lead={lead} />
      <RepairEstimateSection lead={lead} />
    </div>
  );
}
