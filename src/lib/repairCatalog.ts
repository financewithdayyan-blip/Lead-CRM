import { Bath, Droplets, Fan, Home, Layers, PaintBucket, Refrigerator, Square, Wrench, Zap, type LucideIcon } from 'lucide-react';

export interface RepairCatalogItem {
  label: string;
  icon: LucideIcon;
  group: string;
}

// Matches the Rehab Cost Estimator's own line items exactly (see
// RehabCostEstimator.tsx) — its "Use as Est. Repairs" button writes real
// lead_repairs rows under these exact labels, and a new Deal Packet seeds
// its own repairs from that same table (useCreatePacket), so this catalog
// has to use the identical strings for repairIcon() to match them up and
// for quick-add here to stay consistent with what the estimator produces.
// Used to cover 30+ generic wholesaling line items (Deck/Porch, Fencing,
// Landscaping, Pool, ...) — narrowed to just these so every repair on a
// lead traces back to one real, calculated source instead of two
// independent, driftable lists.
export const REPAIR_CATALOG: RepairCatalogItem[] = [
  { label: 'Kitchen', icon: Refrigerator, group: 'Rehab Scope' },
  { label: 'Bathroom', icon: Bath, group: 'Rehab Scope' },
  { label: 'Flooring', icon: Square, group: 'Rehab Scope' },
  { label: 'HVAC', icon: Fan, group: 'Rehab Scope' },
  { label: 'Plumbing', icon: Droplets, group: 'Rehab Scope' },
  { label: 'Electrical', icon: Zap, group: 'Rehab Scope' },
  { label: 'Foundation', icon: Layers, group: 'Rehab Scope' },
  { label: 'Roof', icon: Home, group: 'Rehab Scope' },
  { label: 'Paint', icon: PaintBucket, group: 'Rehab Scope' },
  { label: 'Miscellaneous', icon: Wrench, group: 'Rehab Scope' },
];

const DEFAULT_REPAIR_ICON: LucideIcon = Wrench;

const catalogByLabel = new Map(REPAIR_CATALOG.map((r) => [r.label.toLowerCase(), r]));

// The "5 majors" — standard wholesaling shorthand for the highest-cost
// systems that drive a rehab budget on nearly every deal, worth a one-click
// shortcut instead of searching for each one every time.
export const MAJOR_FIVE = REPAIR_CATALOG.filter((r) => ['Roof', 'HVAC', 'Electrical', 'Plumbing', 'Foundation'].includes(r.label));

/** Icon for a repair line — exact (case-insensitive) match against the
 * catalog, falling back to a generic wrench for anything typed freehand
 * that isn't in it. */
export function repairIcon(item: string): LucideIcon {
  return catalogByLabel.get(item.trim().toLowerCase())?.icon ?? DEFAULT_REPAIR_ICON;
}
