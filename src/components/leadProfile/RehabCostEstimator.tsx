import { useState } from 'react';
import { useUpdateLead } from '@/hooks/useLeads';
import { formatCurrency } from '@/lib/utils';
import type { Lead } from '@/types/domain';

// Same cost model as rfphomes.com's renovation cost estimator (reverse
// engineered from its deployed bundle — the site itself never publishes the
// formula, just the calculator) — every line item below multiplies by the
// finish-level multiplier, subtotal gets a contingency % added on top, and
// the headline range is the total ± 12%. Kept as named constants rather than
// inlined so the numbers are easy to re-check against the source if they
// ever need updating.
const FINISH_MULTIPLIER = { economy: 0.8, standard: 1, premium: 1.35 } as const;
const KITCHEN_BASE = { none: 0, refresh: 12000, full: 28000 } as const;
const BATHROOM_COST = 9000;
const FLOORING_PER_SQFT = 6.5;
const INTERIOR_PAINT_PER_SQFT = 3.2;
const WINDOW_COST = 650;
const ROOF_PER_SQFT = 5.5;
const ROOF_MIN = 9000;
const HVAC_COST = 9500;
const ELECTRICAL_COST = 6500;
const PLUMBING_COST = 6000;
const EXTERIOR_PAINT_COST = 6500;
// Not part of the rfphomes.com source formula — added per the user's own
// number for this line item, same flat-cost pattern as HVAC/Electrical/
// Plumbing/Exterior paint above.
const FOUNDATION_COST = 12000;
const RANGE_PCT = 0.12;

type Finish = keyof typeof FINISH_MULTIPLIER;
type Kitchen = keyof typeof KITCHEN_BASE;

const FINISH_OPTIONS: Array<{ value: Finish; label: string }> = [
  { value: 'economy', label: 'Economy / rental-grade' },
  { value: 'standard', label: 'Standard / retail flip' },
  { value: 'premium', label: 'Premium' },
];
const KITCHEN_OPTIONS: Array<{ value: Kitchen; label: string }> = [
  { value: 'none', label: 'No work' },
  { value: 'refresh', label: 'Refresh (paint, counters, hardware)' },
  { value: 'full', label: 'Full remodel' },
];

/** Rehab budget calculator, same scope-based inputs and formula as the
 *  rfphomes.com tool this was copied from — a planning estimate, not a
 *  contractor bid. Purely local state until "Use as Est. Repairs" is
 *  clicked, which writes the total into the real lead.estRepairs field
 *  (the same single number the Property tab and Overview specs grid show)
 *  — it doesn't touch the itemized repair list below, which is for real
 *  per-line contractor costs rather than a scoped-out planning number. */
export function RehabCostEstimator({ lead }: { lead: Lead }) {
  const updateLead = useUpdateLead();
  const [sqft, setSqft] = useState(lead.sqft ?? 1600);
  const [finish, setFinish] = useState<Finish>('standard');
  const [kitchen, setKitchen] = useState<Kitchen>('none');
  const [bathrooms, setBathrooms] = useState(0);
  const [flooringSqft, setFlooringSqft] = useState(0);
  const [interiorPaint, setInteriorPaint] = useState(false);
  const [windows, setWindows] = useState(0);
  const [roof, setRoof] = useState(false);
  const [hvac, setHvac] = useState(false);
  const [electrical, setElectrical] = useState(false);
  const [plumbing, setPlumbing] = useState(false);
  const [exteriorPaint, setExteriorPaint] = useState(false);
  const [foundation, setFoundation] = useState(false);
  const [contingencyPct, setContingencyPct] = useState(15);
  const [applied, setApplied] = useState(false);

  const f = FINISH_MULTIPLIER[finish];
  const items = [
    { label: 'Kitchen', amount: KITCHEN_BASE[kitchen] * f },
    { label: 'Bathrooms', amount: bathrooms * BATHROOM_COST * f },
    { label: 'Flooring', amount: flooringSqft * FLOORING_PER_SQFT * f },
    { label: 'Interior paint', amount: interiorPaint ? sqft * INTERIOR_PAINT_PER_SQFT * f : 0 },
    { label: 'Windows', amount: windows * WINDOW_COST * f },
    { label: 'Roof', amount: roof ? Math.max(sqft * ROOF_PER_SQFT, ROOF_MIN) * f : 0 },
    { label: 'HVAC', amount: hvac ? HVAC_COST * f : 0 },
    { label: 'Electrical', amount: electrical ? ELECTRICAL_COST * f : 0 },
    { label: 'Plumbing', amount: plumbing ? PLUMBING_COST * f : 0 },
    { label: 'Exterior paint', amount: exteriorPaint ? EXTERIOR_PAINT_COST * f : 0 },
    { label: 'Foundation', amount: foundation ? FOUNDATION_COST * f : 0 },
  ];
  const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
  const contingency = subtotal * (contingencyPct / 100);
  const total = subtotal + contingency;
  const low = total * (1 - RANGE_PCT);
  const high = total * (1 + RANGE_PCT);
  const perSqft = sqft > 0 ? total / sqft : 0;

  const checkboxes: Array<[string, boolean, (v: boolean) => void]> = [
    ['Interior paint', interiorPaint, setInteriorPaint],
    ['Roof', roof, setRoof],
    ['HVAC', hvac, setHvac],
    ['Electrical', electrical, setElectrical],
    ['Plumbing', plumbing, setPlumbing],
    ['Exterior paint', exteriorPaint, setExteriorPaint],
    ['Foundation', foundation, setFoundation],
  ];

  return (
    <div className="card">
      <div className="border-b border-border pb-2.5">
        <div className="text-[15px] font-semibold text-text">Rehab Cost Estimator</div>
        <div className="text-[12px] text-text-3">Scope the work, get a planning-grade budget with a range and contingency.</div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">The property</div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <label className="text-[12px] text-text-2">
                Home size (sqft)
                <input
                  type="number"
                  min={0}
                  className="input mt-1 w-full"
                  value={sqft}
                  onChange={(e) => setSqft(Number(e.target.value) || 0)}
                />
              </label>
              <label className="text-[12px] text-text-2">
                Finish level
                <select className="input mt-1 w-full" value={finish} onChange={(e) => setFinish(e.target.value as Finish)}>
                  {FINISH_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Interior scope</div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <label className="text-[12px] text-text-2">
                Kitchen
                <select className="input mt-1 w-full" value={kitchen} onChange={(e) => setKitchen(e.target.value as Kitchen)}>
                  {KITCHEN_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[12px] text-text-2">
                Bathrooms to remodel
                <input
                  type="number"
                  min={0}
                  className="input mt-1 w-full"
                  value={bathrooms}
                  onChange={(e) => setBathrooms(Number(e.target.value) || 0)}
                />
              </label>
              <label className="text-[12px] text-text-2">
                New flooring (sqft)
                <input
                  type="number"
                  min={0}
                  className="input mt-1 w-full"
                  value={flooringSqft}
                  onChange={(e) => setFlooringSqft(Number(e.target.value) || 0)}
                />
              </label>
              <label className="text-[12px] text-text-2">
                Windows to replace
                <input
                  type="number"
                  min={0}
                  className="input mt-1 w-full"
                  value={windows}
                  onChange={(e) => setWindows(Number(e.target.value) || 0)}
                />
              </label>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Systems &amp; exterior</div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {checkboxes.map(([label, checked, setter]) => (
                <label key={label} className="flex items-center gap-1.5 text-[13px] text-text-2">
                  <input type="checkbox" checked={checked} onChange={(e) => setter(e.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <label className="block w-36 text-[12px] text-text-2">
            Contingency
            <div className="mt-1 flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={50}
                className="input w-full"
                value={contingencyPct}
                onChange={(e) => setContingencyPct(Number(e.target.value) || 0)}
              />
              <span className="text-text-3">%</span>
            </div>
          </label>
        </div>

        <div className="rounded-lg bg-surface-3 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Estimate</div>
          <div className="mt-1 font-mono text-[26px] font-bold text-text">{formatCurrency(total)}</div>
          <div className="text-[11.5px] text-text-3">
            {formatCurrency(low)} – {formatCurrency(high)} range · {formatCurrency(perSqft)}/sqft
          </div>

          <div className="mt-3 space-y-1 border-t border-border-2 pt-3">
            {items.filter((i) => i.amount > 0).length === 0 ? (
              <div className="text-[12px] text-text-3">Nothing scoped yet.</div>
            ) : (
              items
                .filter((i) => i.amount > 0)
                .map((i) => (
                  <div key={i.label} className="flex items-center justify-between text-[12px] text-text-2">
                    <span>{i.label}</span>
                    <span className="font-mono">{formatCurrency(i.amount)}</span>
                  </div>
                ))
            )}
            <div className="flex items-center justify-between border-t border-border-2 pt-1.5 text-[12px] text-text-2">
              <span>Subtotal</span>
              <span className="font-mono">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-[12px] text-text-2">
              <span>Contingency ({contingencyPct}%)</span>
              <span className="font-mono">{formatCurrency(contingency)}</span>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary mt-3 w-full !py-1.5 text-[12.5px]"
            disabled={updateLead.isPending}
            onClick={() =>
              updateLead.mutate(
                { id: lead.id, estRepairs: Math.round(total) },
                { onSuccess: () => { setApplied(true); setTimeout(() => setApplied(false), 2000); } },
              )
            }
          >
            {applied ? '✓ Saved to Repairs' : 'Use as Est. Repairs'}
          </button>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-text-3">
        Planning estimate only, not a contractor bid — verify every number against real bids before committing.
      </p>
    </div>
  );
}
