export type Role = 'admin' | 'caller';

export type AuctionTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'CRITICAL' | 'PAST';

export type LeadStage =
  | 'new'
  | 'voicemail'
  | 'contacted'
  | 'replied'
  | 'initial_contact'
  | 'followup'
  | 'negotiation'
  | 'contract'
  | 'in_title'
  | 'closed'
  | 'dead_declined'
  | 'non_responsive'
  | 'onhold'
  | 'others';

export const STAGE_ORDER: LeadStage[] = [
  'new',
  'voicemail',
  'contacted',
  'replied',
  'initial_contact',
  'followup',
  'negotiation',
  'contract',
  'in_title',
  'closed',
  'dead_declined',
  'non_responsive',
  'onhold',
  'others',
];

// Admins track deals past Contract through to close, and don't need a
// column/option for a cold-calling concern — callers get the reverse:
// Voicemail, but no In Title / Closed. Shared by the Kanban board's columns
// and the lead profile's manual stage picker so both stay consistent.
export function visibleStagesFor(isAdmin: boolean): LeadStage[] {
  return STAGE_ORDER.filter((s) => (isAdmin ? s !== 'voicemail' : s !== 'in_title' && s !== 'closed'));
}

export const STAGE_CONFIG: Record<LeadStage, { label: string; color: string }> = {
  new: { label: 'Cold Lead', color: '#60a5fa' },
  voicemail: { label: 'Voicemail', color: '#f59e0b' },
  // SMS outreach stages — a bulk text moves a lead here automatically, and a
  // reply advances it again. See send-sms and the sms-webhook edge functions.
  contacted: { label: 'Contacted', color: '#38bdf8' },
  replied: { label: 'Replied', color: '#22d3ee' },
  // "Partial Qualified" / "Qualified" here specifically, not "Follow-Up":
  // fully qualified now means photos are actually in hand (see hasPhotos in
  // ai-reply and send-reminders), not just that the interview is done.
  initial_contact: { label: 'Partial Qualified', color: '#a78bfa' },
  followup: { label: 'Qualified', color: '#c084fc' },
  negotiation: { label: 'Negotiation', color: '#fb923c' },
  contract: { label: 'Contract', color: '#10b981' },
  // Post-contract, admin-only stages — a deal in title work, then closed.
  in_title: { label: 'In Title', color: '#6366f1' },
  closed: { label: 'Closed', color: '#C9A24B' },
  dead_declined: { label: 'Dead / Declined', color: '#ef4444' },
  // Auto-detected (detect-non-responsive-leads, daily cron): a lead whose
  // last outbound text has sat unanswered 20+ days, moved here automatically
  // so it's easy to find and try a different sending number for — see
  // SmsThreadTab's "Switch number" control. Unlike On Hold, a reply promotes
  // this straight back to 'replied' (sms-webhook's ADVANCE_FROM) rather than
  // staying pinned, since the whole point of this stage is temporary.
  non_responsive: { label: 'Non Responsive', color: '#78716c' },
  onhold: { label: 'On Hold', color: '#2dd4bf' },
  // Catch-all — leads moved here manually for reasons that don't fit
  // anywhere else in the pipeline. No automated flow ever sets this stage.
  others: { label: 'Others', color: '#94a3b8' },
};

export interface Tag {
  id: string;
  userId: string;
  name: string;
  colorBg: string;
  colorText: string;
}

export interface MarketingSpendEntry {
  id: string;
  userId: string;
  source: string;
  amount: number;
  periodStart: string;
  periodEnd: string;
  notes: string | null;
  createdAt: string;
}

export interface Comp {
  id: string;
  leadId: string;
  kind: CompKind;
  address: string | null;
  price: number | null;
  saleDate: string | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  distance: string | null;
  notes: string | null;
}

export interface LeadFile {
  id: string;
  leadId: string;
  userId: string;
  storagePath: string;
  fileName: string;
  fileType: string | null;
  createdAt: string;
}

export interface RepairFlags {
  cosmetics?: boolean;
  hvac?: boolean;
  plumbing?: boolean;
  roof?: boolean;
  foundation?: boolean;
  electrical?: boolean;
  flooring?: boolean;
}

export interface ScriptAnswers {
  // Confirmation
  confirmation_owner?: string;
  // Motivation
  motivation_owned?: string;
  motivation_reason?: string;
  // Condition
  condition_general?: string;
  condition_rating?: string;
  condition_issues?: string;
  condition_hvac?: string;
  condition_electrical?: string;
  condition_plumbing?: string;
  condition_roof?: string;
  condition_foundation?: string;
  condition_leaks?: string;
  condition_mold?: string;
  // Timeline
  timeline?: string;
  // Price
  price_asking?: string;
  price_reasoning?: string;
  // Mortgage (foreclosure/auction/lien leads only — see LIEN_ADDENDUM)
  mortgage_payment?: string;
  mortgage_balance?: string;
  mortgage_rate?: string;
  mortgage_statement?: string;
  // Decision
  decision?: string;
  // Photo request
  photo_request?: string;
  // Callback
  callback?: string;
}

export interface Lead {
  id: string;
  userId: string;
  leadNum: number | null;
  firstName: string;
  lastName: string;
  phone: string;
  phone2: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  source: string | null;
  stage: LeadStage;
  rating: number;
  propertyRating: number | null;
  propType: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lotSize: string | null;
  yearBuilt: number | null;
  auctionDate: string | null;
  auctionMilestonesNotified: number[];
  condition: string | null;
  motivation: string | null;
  arv: number | null;
  asIs: number | null;
  estRepairs: number | null;
  minOffer: number | null;
  maxOffer: number | null;
  askingPrice: number | null;
  finalPrice: number | null;
  assignmentFee: number | null;
  repairs: RepairFlags;
  scriptAnswers: ScriptAnswers;
  notes: string | null;
  nextFollowUp: string | null;
  /** "HH:MM" 24h, optional — an unset time means Next Follow-Up is an
   *  all-day item, same as Google Calendar's own all-day events. */
  nextFollowUpTime: string | null;
  createdAt: string;
  updatedAt: string;
  tagIds: string[];
  comps?: Comp[];
  files?: LeadFile[];
  aiScore: number | null;
  aiScoreReasoning: string | null;
  aiScoredAt: string | null;
  auctionTier: AuctionTier | null;
  lastAlertDate: string | null;
  /** Set by a STOP/DNC request or a decline. Excludes the lead from all future bulk sends. */
  optedOut: boolean;
  /** Set once fully qualified, or once a human replies by hand. Stops the AI auto-reply. */
  aiReplyPaused: boolean;
  /** True while the AI is still allowed to text this lead despite aiReplyPaused —
   * only meaningful in the Partial Qualified stage, waiting on photos or a
   * callback time. A human manually replying clears it. */
  photoWaitAiActive: boolean;
  /** Set once, the first time this lead's stage enters Qualified-or-beyond — by a trigger, not app code. Null until then. */
  qualifiedAt: string | null;
  /** The number ('1'-'4') this lead was first texted from. Every send after that — bulk or manual — sticks to it, so replies stay in the same Zoom thread. Null until the first send. */
  assignedSmsNumber: string | null;
  /** When the seller told the AI to call back — set from a real answer during qualification, not a placeholder. Null until they actually give one. */
  scheduledCallbackAt: string | null;
  /** The callback time in the seller's own words (e.g. "Tomorrow around 3pm"), kept alongside the parsed timestamp for context. */
  scheduledCallbackNote: string | null;
}

export type BulkSmsJobStatus = 'running' | 'completed' | 'failed' | 'paused';
export type BulkSmsItemStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';

export interface BulkSmsJob {
  id: string;
  status: BulkSmsJobStatus;
  error: string | null;
  total: number;
  createdAt: string;
  completedAt: string | null;
  /** Whether the original send's message/settings were saved, i.e. whether
   * Resume can reconstruct the call without the admin retyping anything. Jobs
   * created before that feature shipped won't have one. */
  hasConfig: boolean;
  /** Only present when fetched via useBulkSmsJobs (the history list, backed
   * by the bulk_sms_jobs_with_counts view) — undefined from useBulkSmsJob's
   * single-row fetch, which gets live per-item counts from
   * useBulkSmsJobItems instead. */
  sentCount?: number;
  skippedCount?: number;
  failedCount?: number;
}

export interface BulkSmsJobItem {
  id: string;
  leadId: string | null;
  leadName: string;
  status: BulkSmsItemStatus;
  sentFrom: string | null;
  detail: string | null;
  updatedAt: string;
}

export type ActivityType = 'note' | 'call' | 'email' | 'meeting' | 'sms' | 'stage_change';

export interface LeadActivity {
  id: string;
  leadId: string;
  userId: string;
  authorName: string;
  authorRole: string;
  type: ActivityType;
  body: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface Task {
  id: string;
  userId: string;
  leadId: string | null;
  title: string;
  dueDate: string | null;
  /** "HH:MM" 24h, optional — unset means an all-day task on dueDate. */
  dueTime: string | null;
  completed: boolean;
  createdAt: string;
  /** Created by the AI or the qualified-stage trigger rather than typed in by
   * hand — kept out of the notification bell, which is for a human's own
   * reminders, not a firehose of auto-generated busywork. Still shows on the
   * Tasks dashboard card either way. */
  autoCreated: boolean;
}

export interface DailySummary {
  id: string;
  userId: string;
  summaryDate: string;
  summary: string;
  createdAt: string;
}

export interface CallingSession {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string | null; // null while the session is still open
  callsLogged: number;
}

export interface LeadShare {
  id: string;
  leadId: string;
  fromUserId: string;
  toUserId: string | null;
  stageAtShare: LeadStage;
  status: 'pending' | 'accepted' | 'declined';
  initiatedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Profile {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  userCode: string;
  role: Role;
  dailyGoal: number;
  monthlyGoal: number;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  ownerId: string;
  memberId: string;
  addedAt: string;
  member: Profile;
}

// ── Deal Packets ────────────────────────────────────────────────────────────

export type PacketStatus = 'draft' | 'active' | 'archived';
export type DealType = 'cash' | 'subject_to' | 'novation' | 'creative';

/** Labels and the blurb each selected structure renders on the public packet. */
export const DEAL_TYPE_CONFIG: Record<DealType, { label: string; description: string }> = {
  cash: {
    label: 'Cash Offer',
    description:
      'A straightforward all-cash purchase with no financing contingency and no appraisal delay — the fastest and most certain path to closing.',
  },
  subject_to: {
    label: 'Subject-To',
    description:
      'The existing mortgage stays in place and payments are taken over, transferring the property without paying off the underlying loan at closing.',
  },
  novation: {
    label: 'Novation',
    description:
      'The property is renovated and resold on the seller’s behalf under an agreement that replaces the original contract, targeting a higher net at closing.',
  },
  creative: {
    label: 'Creative Finance',
    description:
      'A tailored structure — seller carry, wrap, or a hybrid — built around the seller’s timeline and payoff requirements rather than a single fixed offer.',
  },
};

/** The major systems a Deal Packet's Property Condition section rates,
 * each Good / Fair / Poor — separate from a lead's RepairFlags (a plain
 * needs-repair checklist), this is an investor-facing condition summary. */
export type ConditionSystem = 'electrical' | 'roof' | 'hvac' | 'plumbing' | 'foundation' | 'windowsDoors' | 'flooring';
export type ConditionRating = 'good' | 'fair' | 'poor';
export type ConditionRatings = Partial<Record<ConditionSystem, ConditionRating>>;

export const CONDITION_SYSTEMS: ConditionSystem[] = [
  'electrical', 'roof', 'hvac', 'plumbing', 'foundation', 'windowsDoors', 'flooring',
];

export const CONDITION_SYSTEM_LABELS: Record<ConditionSystem, string> = {
  electrical: 'Electrical',
  roof: 'Roof',
  hvac: 'HVAC',
  plumbing: 'Plumbing',
  foundation: 'Foundation',
  windowsDoors: 'Windows & Doors',
  flooring: 'Flooring',
};

export type CompKind = 'sold' | 'listing';

export interface PacketComp {
  id: string;
  /** 'sold' is a closed comp; 'listing' is currently on the market. */
  kind: CompKind;
  address: string | null;
  salePrice: number | null;
  saleDate: string | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  lat: number | null;
  lng: number | null;
}

export interface PacketRepair {
  id: string;
  item: string;
  cost: number;
}

export interface PacketImage {
  id: string;
  storagePath: string;
  caption: string | null;
}

export interface PacketVideo {
  id: string;
  storagePath: string;
  caption: string | null;
}

export interface DealPacket {
  id: string;
  leadId: string;
  userId: string;
  /** Public URL token — the packet is shared as /crm/deal/{slug}. */
  slug: string;
  status: PacketStatus;

  ownerName: string | null;
  propType: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  market: string | null;
  leadStatus: string | null;

  // No street address by design — a packet shows the area only, never an exact
  // location, so it does not carry one.
  city: string | null;
  state: string | null;
  zip: string | null;

  // Coordinates only, geocoded admin-side from the lead's real address —
  // never the address itself. Lets the map draw a proximity circle around
  // the subject without ever plotting a pin on it or exposing which exact
  // point within the circle is the real property.
  subjectLat: number | null;
  subjectLng: number | null;

  purchasePrice: number | null;
  /** Entered, not derived. Covered by Bluebird and shown to investors. */
  closingCost: number | null;
  arv: number | null;
  arvIsManual: boolean;
  assignmentFee: number | null;
  showAssignmentFee: boolean;

  dealTypes: DealType[];
  narrative: string | null;
  requireLeadCapture: boolean;

  createdAt: string;
  updatedAt: string;

  conditionRatings: ConditionRatings;

  comps: PacketComp[];
  repairs: PacketRepair[];
  images: PacketImage[];
  videos: PacketVideo[];
}

export interface PacketView {
  id: string;
  packetId: string;
  viewerToken: string;
  viewerName: string | null;
  viewerEmail: string | null;
  viewerPhone: string | null;
  userAgent: string | null;
  createdAt: string;
}

/** Private feedback from an investor viewing a packet — visible only to the
 * packet's owner, never to other investors. */
export interface PacketComment {
  id: string;
  packetId: string;
  viewerToken: string;
  viewerName: string | null;
  viewerEmail: string | null;
  body: string;
  createdAt: string;
}

export interface TeamInvite {
  id: string;
  ownerId: string;
  email: string;
  role: Role;
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: string;
  acceptedAt: string | null;
}

// ── Disposition — cash buyers ────────────────────────────────────────────────

export type BuyerPropertyType = 'single_family' | 'multi_family' | 'townhome' | 'condo' | 'land' | 'mobile' | 'other';

export const BUYER_PROPERTY_TYPE_LABELS: Record<BuyerPropertyType, string> = {
  single_family: 'Single Family',
  multi_family: 'Multi-Family',
  townhome: 'Townhome',
  condo: 'Condo',
  land: 'Land',
  mobile: 'Mobile / Manufactured',
  other: 'Other',
};

export type BuyerCondition = 'fixer' | 'turnkey' | 'either';

export const BUYER_CONDITION_LABELS: Record<BuyerCondition, string> = {
  fixer: 'Fixer only',
  turnkey: 'Turnkey only',
  either: 'Either',
};

export interface CashBuyer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  facebookUrl: string | null;
  marketStates: string[];
  marketCounties: string[];
  marketCities: string[];
  propertyTypes: BuyerPropertyType[];
  priceMin: number | null;
  priceMax: number | null;
  minBeds: number | null;
  minBaths: number | null;
  condition: BuyerCondition | null;
  dealTypes: DealType[];
  notes: string | null;
  status: 'active' | 'inactive';
  smsOptedOut: boolean;
  assignedSmsNumber: string | null;
  createdAt: string;
  updatedAt: string;
}
