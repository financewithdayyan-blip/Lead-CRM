import {
  AppWindow,
  Archive,
  Biohazard,
  Bug,
  ChefHat,
  CloudRain,
  Construction,
  Droplets,
  Fan,
  Fence,
  Flame,
  Grid3x3,
  Hammer,
  Home,
  Layers,
  Lightbulb,
  PaintBucket,
  Paintbrush,
  PanelTop,
  PanelsTopLeft,
  Refrigerator,
  Ruler,
  ShieldAlert,
  ShowerHead,
  Siren,
  Snowflake,
  Sparkles,
  Square,
  Trash2,
  TreePine,
  Warehouse,
  Waves,
  Wrench,
  DoorOpen,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export interface RepairCatalogItem {
  label: string;
  icon: LucideIcon;
  group: string;
}

// Common wholesaling repair line items, major and minor, grouped for a
// scannable dropdown rather than one long flat list. Not exhaustive by
// design — a picked or typed item that isn't here still works fine (see
// repairIcon's fallback below), this just covers what comes up often enough
// to be worth one click instead of typing it out every time.
export const REPAIR_CATALOG: RepairCatalogItem[] = [
  // Major systems & structural
  { label: 'Roof Replacement', icon: Home, group: 'Major Systems' },
  { label: 'Foundation Repair', icon: Layers, group: 'Major Systems' },
  { label: 'Structural / Framing Repair', icon: Construction, group: 'Major Systems' },
  { label: 'HVAC System', icon: Fan, group: 'Major Systems' },
  { label: 'Electrical Rewiring', icon: Zap, group: 'Major Systems' },
  { label: 'Plumbing Repipe', icon: Droplets, group: 'Major Systems' },
  { label: 'Water Heater', icon: Flame, group: 'Major Systems' },
  { label: 'Sewer Line Repair', icon: Droplets, group: 'Major Systems' },
  { label: 'Septic System', icon: Droplets, group: 'Major Systems' },
  { label: 'Well / Water System', icon: Droplets, group: 'Major Systems' },
  { label: 'Sump Pump', icon: Droplets, group: 'Major Systems' },
  { label: 'Chimney Repair', icon: Flame, group: 'Major Systems' },

  // Hazard & damage remediation
  { label: 'Mold Remediation', icon: Biohazard, group: 'Hazard & Damage' },
  { label: 'Asbestos Abatement', icon: ShieldAlert, group: 'Hazard & Damage' },
  { label: 'Lead Paint Remediation', icon: ShieldAlert, group: 'Hazard & Damage' },
  { label: 'Pest / Termite Treatment', icon: Bug, group: 'Hazard & Damage' },
  { label: 'Fire / Smoke Damage', icon: Flame, group: 'Hazard & Damage' },
  { label: 'Water Damage Restoration', icon: Droplets, group: 'Hazard & Damage' },

  // Exterior
  { label: 'Siding Repair / Replacement', icon: PanelsTopLeft, group: 'Exterior' },
  { label: 'Window Replacement', icon: AppWindow, group: 'Exterior' },
  { label: 'Exterior Doors', icon: DoorOpen, group: 'Exterior' },
  { label: 'Garage Door', icon: Warehouse, group: 'Exterior' },
  { label: 'Gutters & Downspouts', icon: CloudRain, group: 'Exterior' },
  { label: 'Exterior Paint', icon: PaintBucket, group: 'Exterior' },
  { label: 'Driveway / Concrete', icon: Square, group: 'Exterior' },
  { label: 'Fencing', icon: Fence, group: 'Exterior' },
  { label: 'Deck / Porch Repair', icon: Hammer, group: 'Exterior' },
  { label: 'Landscaping / Tree Removal', icon: TreePine, group: 'Exterior' },
  { label: 'Pool Repair / Removal', icon: Waves, group: 'Exterior' },

  // Interior & cosmetic
  { label: 'Kitchen Remodel', icon: ChefHat, group: 'Interior & Cosmetic' },
  { label: 'Bathroom Remodel', icon: ShowerHead, group: 'Interior & Cosmetic' },
  { label: 'Flooring', icon: Grid3x3, group: 'Interior & Cosmetic' },
  { label: 'Interior Paint', icon: Paintbrush, group: 'Interior & Cosmetic' },
  { label: 'Drywall Repair', icon: PanelTop, group: 'Interior & Cosmetic' },
  { label: 'Cabinets & Countertops', icon: Archive, group: 'Interior & Cosmetic' },
  { label: 'Trim & Molding', icon: Ruler, group: 'Interior & Cosmetic' },
  { label: 'Insulation', icon: Snowflake, group: 'Interior & Cosmetic' },
  { label: 'Appliances', icon: Refrigerator, group: 'Interior & Cosmetic' },
  { label: 'Lighting & Electrical Fixtures', icon: Lightbulb, group: 'Interior & Cosmetic' },
  { label: 'Smoke / CO Detectors', icon: Siren, group: 'Interior & Cosmetic' },

  // General
  { label: 'Junk Removal / Debris', icon: Trash2, group: 'General' },
  { label: 'Cosmetic Rehab & Cleanup', icon: Sparkles, group: 'General' },
  { label: 'Miscellaneous / Other', icon: Wrench, group: 'General' },
];

const DEFAULT_REPAIR_ICON: LucideIcon = Wrench;

const catalogByLabel = new Map(REPAIR_CATALOG.map((r) => [r.label.toLowerCase(), r]));

/** Icon for a repair line — exact (case-insensitive) match against the
 * catalog, falling back to a generic wrench for anything typed freehand
 * that isn't in it. */
export function repairIcon(item: string): LucideIcon {
  return catalogByLabel.get(item.trim().toLowerCase())?.icon ?? DEFAULT_REPAIR_ICON;
}
