export interface CsStep {
  id: string;
  label: string | null;
  title: string;
  script?: string | null;
  note?: boolean;
  hasComps?: boolean;
  comps?: number;
  hasPhotoUpload?: boolean;
}

export const CS_STEPS: CsStep[] = [
  { id: 's1', label: 'Step 1', title: 'Are you interested in selling your house for the right price?', script: null, note: true },
  { id: 's2', label: 'Step 2', title: 'Initial Asking Price', script: '"How much are you looking to get for that property?"', note: true },
  { id: 's3', label: 'Step 3', title: 'Their Situation', script: '"Tell me a little bit about what you\'ve got going on…"', note: true },
  { id: 'comps', label: null, title: 'Comps (ARV Research)', hasComps: true, comps: 3 },
  { id: 's4', label: 'Step 4', title: 'How did they come up with that price?', script: '"How did you come up with that number?"', note: true },
  {
    id: 's5',
    label: 'Step 5',
    title: 'Best Price (Closing Question)',
    script: '"If I covered all closing costs, closed on your timeline, and zero realtor commissions — what\'s the best price you can do for me today?"',
    note: true,
  },
  { id: 's6', label: 'Step 6', title: 'Their Motivation', script: '"What\'s your reason for selling — is there a timeline you\'re working with?"', note: true },
  {
    id: 's7',
    label: 'Step 7',
    title: 'Property Condition',
    script: '"Tell me a bit more about the condition of your property — what would you rate it out of 10? Any plumbing, electrical, HVAC, foundational, or roof issues?"',
    note: true,
  },
  { id: 's8', label: 'Step 8', title: 'Timeline & Flexibility', script: '"When would you ideally like to close? Is that date flexible?"', note: true },
  {
    id: 's9',
    label: 'Step 9',
    title: 'Decision Makers',
    script: '"Is there anyone else involved in making this decision — a spouse, partner, or attorney?"',
    note: true,
  },
  { id: 's10', label: 'Step 10', title: 'Request Property Photos', script: null, note: false, hasPhotoUpload: true },
];
