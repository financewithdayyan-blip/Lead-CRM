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
  | 'dead_declined'
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
  'dead_declined',
  'onhold',
  'others',
];

export const STAGE_CONFIG: Record<LeadStage, { label: string; color: string }> = {
  new: { label: 'Cold Lead', color: '#60a5fa' },
  voicemail: { label: 'Voicemail', color: '#f59e0b' },
  // SMS outreach stages — a bulk text moves a lead here automatically, and a
  // reply advances it again. See send-sms and the sms-webhook edge functions.
  contacted: { label: 'Contacted', color: '#38bdf8' },
  replied: { label: 'Replied', color: '#22d3ee' },
  initial_contact: { label: 'Qualified', color: '#a78bfa' },
  followup: { label: 'Follow-Up', color: '#c084fc' },
  negotiation: { label: 'Negotiation', color: '#fb923c' },
  contract: { label: 'Contract', color: '#10b981' },
  dead_declined: { label: 'Dead / Declined', color: '#ef4444' },
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
  // Motivation
  motivation_owned?: string;
  motivation_reason?: string;
  motivation_now?: string;
  // Condition
  condition_general?: string;
  condition_rating?: string;
  condition_issues?: string;
  condition_hvac?: string;
  condition_plumbing?: string;
  condition_roof?: string;
  // Timeline
  timeline?: string;
  // Price
  price_asking?: string;
  price_reasoning?: string;
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
  repairs: RepairFlags;
  scriptAnswers: ScriptAnswers;
  notes: string | null;
  nextFollowUp: string | null;
  createdAt: string;
  updatedAt: string;
  tagIds: string[];
  comps?: Comp[];
  files?: LeadFile[];
  aiScore: number | null;
  aiScoreReasoning: string | null;
  aiScoredAt: string | null;
  followupStartDate: string | null;
  touchCount: number;
  touchDates: string[];
  earlyExitOverride: boolean;
  auctionTier: AuctionTier | null;
  lastAlertDate: string | null;
  /** Set by a STOP/DNC request or a decline. Excludes the lead from all future bulk sends. */
  optedOut: boolean;
  /** Set once fully qualified, or once a human replies by hand. Stops the AI auto-reply. */
  aiReplyPaused: boolean;
  /** Set once, the first time this lead's stage enters Qualified-or-beyond — by a trigger, not app code. Null until then. */
  qualifiedAt: string | null;
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
  completed: boolean;
  createdAt: string;
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

  comps: PacketComp[];
  repairs: PacketRepair[];
  images: PacketImage[];
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

export interface TeamInvite {
  id: string;
  ownerId: string;
  email: string;
  role: Role;
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: string;
  acceptedAt: string | null;
}
