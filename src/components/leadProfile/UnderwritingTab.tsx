import { useState } from 'react';
import { LeadCompsSection } from './LeadCompsSection';
import { RepairEstimateSection, MAO_ARV_PCT, MAO_REPAIR_MULTIPLIER, MAO_MIN_FEE } from './RepairEstimateSection';
import { useLeadRepairs } from '@/hooks/useLeadRepairs';
import { formatCurrency } from '@/lib/utils';
import type { Lead } from '@/types/domain';

/** Visual breakdown of the exact same MAO formula RepairEstimateSection
 * already computes and lets you apply as the Cash Offer — this card adds
 * nothing new to the math, it just shows the real waterfall behind the
 * number instead of a single inline line of text, plus a what-if preview.
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
  const mao = arv * MAO_ARV_PCT - repairsCost - MAO_MIN_FEE;
  const maxBar = Math.max(arv, 1);

  const previewArv = whatIfArv ?? arv;
  const previewRepairs = whatIfRepairs ?? totalRepairs;
  const previewMao = previewArv * MAO_ARV_PCT - MAO_REPAIR_MULTIPLIER * previewRepairs - MAO_MIN_FEE;
  const isExploring = whatIfArv !== null || whatIfRepairs !== null;

  const rows = [
    { label: 'After-repair value', amount: arv, positive: true },
    { label: 'Holding and closing, 10%', amount: holding, positive: false },
    { label: 'Repairs, counted twice', amount: repairsCost, positive: false },
    { label: 'Our fee', amount: MAO_MIN_FEE, positive: false },
  ];

  return (
    <div className="card">
      <div className="border-b border-border pb-2.5">
        <div className="text-[15px] font-semibold text-text">How we got to {formatCurrency(mao)}</div>
        <div className="text-[12px] text-text-3">ARV × 90%, minus repairs twice, minus our $10k fee</div>
      </div>

      <div className="mt-3 space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <div className="w-44 shrink-0 text-[12.5px] text-text-2">{r.label}</div>
            <div className="h-5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className={`h-full rounded-full ${r.positive ? 'bg-primary' : 'bg-danger/55'}`}
                style={{ width: `${Math.min(100, (r.amount / maxBar) * 100)}%` }}
              />
            </div>
            <div className={`w-28 shrink-0 text-right font-mono text-[12.5px] font-semibold ${r.positive ? 'text-text' : 'text-danger'}`}>
              {r.positive ? formatCurrency(r.amount) : `-${formatCurrency(r.amount)}`}
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3 border-t border-border-2 pt-2.5">
          <div className="w-44 shrink-0 text-[12.5px] font-semibold text-text">Max allowable offer</div>
          <div className="h-5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-success" style={{ width: `${Math.min(100, Math.max(0, (mao / maxBar) * 100))}%` }} />
          </div>
          <div className="w-28 shrink-0 text-right font-mono text-[13px] font-bold text-success">{formatCurrency(mao)}</div>
        </div>
      </div>

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
