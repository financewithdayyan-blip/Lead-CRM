// Soft suggestions only — the source field stays free text everywhere it's
// used, this just nudges toward consistent spelling so future reporting
// (contact rate by list, cost per lead by source) doesn't fragment into
// near-duplicate buckets.
export const LEAD_SOURCE_SUGGESTIONS = [
  'Cold Call',
  'Direct Mail',
  'Driving for Dollars',
  'PropStream',
  'Referral',
  'Website',
  'SMS/Text Blast',
  'Zillow/FSBO',
  'Cash Buyer List',
];

export function normalizeSourceKey(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}
