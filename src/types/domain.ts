export type Role = 'admin' | 'manager' | 'rep';

export type LeadStatus =
  | 'new'
  | 'voicemail'
  | 'followup'
  | 'followup2'
  | 'followup3'
  | 'negotiating'
  | 'contract'
  | 'dead'
  | 'declined'
  | 'onhold';

export const STATUS_CONFIG: Record<LeadStatus, { label: string; color: string }> = {
  new: { label: 'Cold Lead', color: '#60a5fa' },
  voicemail: { label: 'Voicemail', color: '#f59e0b' },
  followup: { label: 'Initial Contact', color: '#a78bfa' },
  followup2: { label: 'Follow-Up', color: '#c084fc' },
  followup3: { label: 'Follow-Up (3rd)', color: '#e879f9' },
  negotiating: { label: 'Negotiation', color: '#fb923c' },
  contract: { label: 'Contract', color: '#10b981' },
  dead: { label: 'Dead', color: '#ef4444' },
  declined: { label: 'Declined', color: '#fb923c' },
  onhold: { label: 'On Hold', color: '#2dd4bf' },
};

export const OUTCOME_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: ['voicemail', 'followup', 'negotiating', 'contract', 'dead', 'declined', 'onhold'],
  voicemail: ['voicemail', 'followup', 'negotiating', 'contract', 'dead', 'declined', 'onhold'],
  followup: ['followup2', 'negotiating', 'contract', 'dead', 'declined', 'onhold', 'voicemail'],
  followup2: ['followup3', 'negotiating', 'contract', 'dead', 'declined', 'onhold', 'voicemail'],
  followup3: ['negotiating', 'contract', 'dead', 'declined', 'onhold', 'voicemail'],
  negotiating: ['contract', 'dead', 'declined', 'onhold', 'followup'],
  contract: ['dead', 'onhold'],
  dead: ['new', 'followup'],
  declined: ['new', 'followup'],
  onhold: ['followup', 'negotiating', 'dead', 'declined'],
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
  address: string;
  price: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  distance: string | null;
  notes: string | null;
}

export interface CallAnswers {
  stillWantsToSell?: string;
  propertyDetails?: string;
  reasonForSelling?: string;
  conditionOverview?: string;
  conditionRating?: number;
  systemsIssues?: string;
  systemsDetails?: string;
  hasTargetDate?: string;
  targetDate?: string;
  askingPriceAnswer?: string;
  priceOrigin?: string;
  decisionMakers?: string;
  decisionMakerDetails?: string;
  bestCallbackTime?: string;
}

export interface RepairFlags {
  cosmetics?: boolean;
  hvac?: boolean;
  plumbing?: boolean;
  roof?: boolean;
  foundation?: boolean;
  electrical?: boolean;
}

export interface KcfState {
  checks: Record<string, boolean>;
  fields: Record<string, string>;
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
  state: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lotSize: string | null;
  propType: string | null;
  extra: string | null;
  batch: string | null;
  status: LeadStatus;
  rating: number;
  propertyRating: number | null;
  note: string | null;
  motivation: string | null;
  yearBuilt: number | null;
  condition: string | null;
  arv: number | null;
  asIs: number | null;
  estRepairs: number | null;
  minOffer: number | null;
  maxOffer: number | null;
  askingPrice: number | null;
  finalPrice: number | null;
  repairs: RepairFlags;
  callAnswers: CallAnswers;
  kcfData: KcfState;
  followupDate: string | null;
  nextCallDate: string | null;
  voicemailCount: number;
  calledAt: string | null;
  createdAt: string;
  updatedAt: string;
  tagIds: string[];
  comps?: Comp[];
  photoUrls?: string[];
}

export interface CallLogEntry {
  id: string;
  userId: string;
  leadId: string | null;
  leadNum: number | null;
  name: string;
  phone: string;
  address: string | null;
  status: LeadStatus;
  rating: number;
  note: string | null;
  tagIds: string[];
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

export interface Profile {
  id: string;
  email: string;
  callerName: string | null;
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

export interface DailyStat {
  userId: string;
  statDate: string;
  calls: number;
  conversations: number;
  voicemail: number;
  dead: number;
}

export interface SessionLogEntry {
  userId: string;
  sessionDate: string;
  durationSeconds: number;
  callsMade: number;
}

export const LEAD_SCORE_THRESHOLDS = { hot: 60, warm: 30 } as const;
