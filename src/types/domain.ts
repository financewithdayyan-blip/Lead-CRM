export type Role = 'admin' | 'manager' | 'rep';

export type LeadStage =
  | 'new'
  | 'voicemail'
  | 'initial_contact'
  | 'followup'
  | 'negotiation'
  | 'contract'
  | 'dead_declined'
  | 'onhold';

export const STAGE_ORDER: LeadStage[] = [
  'new',
  'voicemail',
  'initial_contact',
  'followup',
  'negotiation',
  'contract',
  'dead_declined',
  'onhold',
];

export const STAGE_CONFIG: Record<LeadStage, { label: string; color: string }> = {
  new: { label: 'Cold Lead', color: '#60a5fa' },
  voicemail: { label: 'Voicemail', color: '#f59e0b' },
  initial_contact: { label: 'Initial Contact', color: '#a78bfa' },
  followup: { label: 'Follow-Up', color: '#c084fc' },
  negotiation: { label: 'Negotiation', color: '#fb923c' },
  contract: { label: 'Contract', color: '#10b981' },
  dead_declined: { label: 'Dead / Declined', color: '#ef4444' },
  onhold: { label: 'On Hold', color: '#2dd4bf' },
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
  address: string | null;
  price: number | null;
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
  notes: string | null;
  nextFollowUp: string | null;
  createdAt: string;
  updatedAt: string;
  tagIds: string[];
  comps?: Comp[];
  files?: LeadFile[];
}

export type ActivityType = 'note' | 'call' | 'email' | 'meeting' | 'sms' | 'stage_change';

export interface LeadActivity {
  id: string;
  leadId: string;
  userId: string;
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
