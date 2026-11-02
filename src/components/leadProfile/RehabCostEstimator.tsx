import { useEffect, useRef, useState } from 'react';
import { useUpdateLead } from '@/hooks/useLeads';
import { useReplaceLeadRepairs } from '@/hooks/useLeadRepairs';
import { formatCurrency } from '@/lib/utils';
import type { Lead, RehabEstimatorConfig } from '@/types/domain';

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
 *  contractor bid. Initialized from lead.rehabEstimatorConfig when one's
 *  already on file, so reopening the lead shows what was actually scoped
 *  last time instead of a blank form with only the resulting total to show
 *  for it. "Use as Est. Repairs" saves that full config back (alongside the
 *  total, on lead.estRepairs — the single number the Property tab and
 *  Overview specs grid show) AND replaces this lead's itemized
 *  lead_repairs rows with its own 10-category breakdown (repairCatalog.ts)
 *  — the one real source a Deal Packet's own repairs then seed from
 *  (useCreatePacket) instead of starting empty. */
export function RehabCostEstimator({ lead }: { lead: Lead }) {
  const updateLead = useUpdateLead();
  const replaceRepairs = useReplaceLeadRepairs();
  const saved = lead.rehabEstimatorConfig;
  const [sqft, setSqft] = useState(saved?.sqft ?? lead.sqft ?? 1600);
  const [finish, setFinish] = useState<Finish>(saved?.finish ?? 'standard');
  const [kitchen, setKitchen] = useState<Kitchen>(saved?.kitchen ?? 'none');
  const [bathrooms, setBathrooms] = useState(saved?.bathrooms ?? 0);
  const [flooringSqft, setFlooringSqft] = useState(saved?.flooringSqft ?? 0);
  const [interiorPaint, setInteriorPaint] = useState(saved?.interiorPaint ?? false);
  const [windows, setWindows] = useState(saved?.windows ?? 0);
  const [roof, setRoof] = useState(saved?.roof ?? false);
  const [hvac, setHvac] = useState(saved?.hvac ?? false);
  const [electrical, setElectrical] = useState(saved?.electrical ?? false);
  const [plumbing, setPlumbing] = useState(saved?.plumbing ?? false);
  const [exteriorPaint, setExteriorPaint] = useState(saved?.exteriorPaint ?? false);
  const [foundation, setFoundation] = useState(saved?.foundation ?? false);
  const [contingencyPct, setContingencyPct] = useState(saved?.contingencyPct ?? 15);
  const [applied, setApplied] = useState(false);

  // useState's initializer above only ever runs once, on mount — but the
  // Lead Profile page seeds `lead` from the trimmed list cache first (no
  // rehab_estimator_config on it) and fetches the full record a moment
  // later in the background, so this component routinely mounts BEFORE
  // the saved config has actually arrived. Without this effect, the form
  // would permanently lock in blank defaults the instant it mounted and
  // never pick up the real saved scope once it loads. hydratedRef makes
  // this a one-time sync (don't fight the admin's own edits afterward),
  // already-true at mount if the config happened to be there in time for
  // the useState initializer to use it correctly on its own.
  const hydratedRef = useRef(!!saved);
  useEffect(() => {
    if (hydratedRef.current || !lead.rehabEstimatorConfig) return;
    hydratedRef.current = true;
    const c = lead.rehabEstimatorConfig;
    setSqft(c.sqft);
    setFinish(c.finish);
    setKitchen(c.kitchen);
    setBathrooms(c.bathrooms);
    setFlooringSqft(c.flooringSqft);
    setInteriorPaint(c.interiorPaint);
    setWindows(c.windows);
    setRoof(c.roof);
    setHvac(c.hvac);
    setElectrical(c.electrical);
    setPlumbing(c.plumbing);
    setExteriorPaint(c.exteriorPaint);
    setFoundation(c.foundation);
    setContingencyPct(c.contingencyPct);
  }, [lead.rehabEstimatorConfig]);

  const f = FINISH_MULTIPLIER[finish];
  const kitchenCost = KITCHEN_BASE[kitchen] * f;
  const bathroomsCost = bathrooms * BATHROOM_COST * f;
  const flooringCost = flooringSqft * FLOORING_PER_SQFT * f;
  const interiorPaintCost = interiorPaint ? sqft * INTERIOR_PAINT_PER_SQFT * f : 0;
  const windowsCost = windows * WINDOW_COST * f;
  const roofCost = roof ? Math.max(sqft * ROOF_PER_SQFT, ROOF_MIN) * f : 0;
  const hvacCost = hvac ? HVAC_COST * f : 0;
  const electricalCost = electrical ? ELECTRICAL_COST * f : 0;
  const plumbingCost = plumbing ? PLUMBING_COST * f : 0;
  const exteriorPaintCost = exteriorPaint ? EXTERIOR_PAINT_COST * f : 0;
  const foundationCost = foundation ? FOUNDATION_COST * f : 0;

  const items = [
    { label: 'Kitchen', amount: kitchenCost },
    { label: 'Bathrooms', amount: bathroomsCost },
    { label: 'Flooring', amount: flooringCost },
    { label: 'Interior paint', amount: interiorPaintCost },
    { label: 'Windows', amount: windowsCost },
    { label: 'Roof', amount: roofCost },
    { label: 'HVAC', amount: hvacCost },
    { label: 'Electrical', amount: electricalCost },
    { label: 'Plumbing', amount: plumbingCost },
    { label: 'Exterior paint', amount: exteriorPaintCost },
    { label: 'Foundation', amount: foundationCost },
  ];
  const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
  const contingency = subtotal * (contingencyPct / 100);
  const total = subtotal + contingency;
  const low = total * (1 - RANGE_PCT);
  const high = total * (1 + RANGE_PCT);
  const perSqft = sqft > 0 ? total / sqft : 0;

  // Collapsed onto the repair catalog's own 10 categories (repairCatalog.ts)
  // for the real lead_repairs rows "Use as Est. Repairs" writes — Windows
  // has no matching bucket there, so it folds into Miscellaneous alongside
  // the contingency instead of being silently dropped.
  const catalogItems = [
    { item: 'Kitchen', cost: kitchenCost },
    { item: 'Bathroom', cost: bathroomsCost },
    { item: 'Flooring', cost: flooringCost },
    { item: 'HVAC', cost: hvacCost },
    { item: 'Plumbing', cost: plumbingCost },
    { item: 'Electrical', cost: electricalCost },
    { item: 'Foundation', cost: foundationCost },
    { item: 'Roof', cost: roofCost },
    { item: 'Paint', cost: interiorPaintCost + exteriorPaintCost },
    { item: 'Miscellaneous', cost: windowsCost + contingency },
  ]
    .filter((i) => i.cost > 0)
    .map((i) => ({ ...i, cost: Math.round(i.cost) }));

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
            disabled={updateLead.isPending || replaceRepairs.isPending}
            onClick={() => {
              const config: RehabEstimatorConfig = {
                sqft, finish, kitchen, bathrooms, flooringSqft, interiorPaint,
                windows, roof, hvac, electrical, plumbing, exteriorPaint, foundation, contingencyPct,
              };
              updateLead.mutate(
                { id: lead.id, estRepairs: Math.round(total), rehabEstimatorConfig: config },
                { onSuccess: () => { setApplied(true); setTimeout(() => setApplied(false), 2000); } },
              );
              replaceRepairs.mutate({ leadId: lead.id, items: catalogItems });
            }}
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
