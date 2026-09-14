/**
 * Distinguishes a real individual (or a personal trust — kept, same as an
 * individual) from an LLC/Corp/government agency/church/charity/unsuffixed
 * business — anything that isn't a person you could actually call about
 * their own property. Built from a manual, name-by-name review of a real
 * bad import (2,104 rows, see the Kanban "Cold" cleanup) — the keyword list
 * below is what that review converged on, not a guess. No keyword list
 * catches every unsuffixed proper-noun business ("Sheepshead Restaurant"),
 * so this is "catches the large majority," not "catches everything."
 */

const ENTITY_KEYWORDS = [
  'LLC', 'L L C', 'LLP', 'LP', 'PLLC', 'PC', 'P.C.', 'INC', 'INCORPORATED', 'CORP', 'CORPORATION',
  'CO ', ' CO,', 'LTD', 'LIMITED', 'REALTY', 'REALTORS', 'REALT', 'RLTY', 'RLTYCP', 'HOLDINGS',
  'HOLDING', 'HOLDCO', 'GROUP', 'ASSOCIATES', 'ASSOCS', 'ASSOC', 'ASSN', 'ASSOCIATION', 'PARTNERS',
  'PARTNERSHIP', 'PROPERTIES', 'PROPCO', 'PROPERTY', 'MANAGEMENT', 'MGMT', 'ENTERPRISE', 'ENTERPRISES',
  'VENTURES', 'CAPITAL', 'INVESTMENTS', 'INVESTMENT', 'DEVELOPMENT', 'DEVELOP', 'DEVELOPERS',
  'CONSTRUCTION', 'BUILDERS', 'HOMES', 'ESTATES', 'HOUSING', 'APARTMENT', 'APARTMENTS', 'OWNER',
  'OWNERS', 'OWNRS', 'BANK', 'FUND', 'REIT', 'EQUITIES', 'EQUITY', 'FUNDING', 'SOLUTION', 'SOLUTIONS',
  'SERVICE', 'SERVICES', 'NETWORK', 'ALLIANCE', 'INITIATIVE', 'CLUB',
  // Religious / charitable / civic institutions
  'CHURCH', 'CHUR', 'MINISTR', 'FOUNDATION', 'INSTITUTE', 'PARISH', 'DIOCESE', 'CONGREGATION',
  'TEMPLE', 'SYNAGOGUE', 'MOSQUE', 'ISLAMIC CENTER', 'IGLESIA', 'METHODIST', 'BAPTIST', 'LUTHERAN',
  'CATHOLIC', 'PRESBYTERIAN', 'EPISCOPAL', 'EPISC', 'MISSION', 'SAMARITAN', 'SALVATION ARMY',
  'CHARITY', 'CHARITIES', 'NONPROFIT', 'NON-PROFIT',
  // Government / quasi-government
  'HOSPITAL', 'SCHOOL', 'ACADEMY', 'CITY OF', 'TOWN OF', 'VILLAGE OF', 'COUNTY OF', 'STATE OF',
  'AUTHORITY', 'HUD', 'HABITAT', 'LIBRARY', 'UNIVERSITY', 'COLLEGE', 'CURATORS', 'REGENTS',
  'DEPARTMENT', 'DEPT', 'BOARD OF', 'COMMISSION', 'DISTRICT', 'MUNICIPAL', 'GOVERNMENT', 'FEDERAL',
  'SECRETARY OF', 'SECY OF', 'POSTAL SERVICE', 'FANNIE MAE', 'FREDDIE MAC',
  // Neighborhood/community orgs, cemeteries — institutional, not a person
  'NEIGHBORHOOD ASSOC', 'CEMETERY', 'FOUNDLING',
];
const TRUST_KEYWORDS = ['TRUST', 'TRUSTEE', 'TRSTE', 'TRST', 'IRREVOCABLE', 'REVOCABLE', 'IRT'];
const STREET_TYPE_WORDS = [
  'STREET', 'STR', 'AVENUE', 'AVE', 'BOULEVARD', 'BLVD', 'DRIVE', 'DR', 'ROAD', 'RD', 'PLACE', 'PL',
  'COURT', 'CT', 'LANE', 'LN', 'TERRACE', 'TER', 'WAY', 'CIRCLE', 'CIR', 'PARKWAY', 'PKWY',
];

/** Some LLCs in property records are named after their own address ("606
 * West 191st Street LLC") — when the entity suffix has been truncated off
 * by a source system's fixed-width column (a real, confirmed issue), what's
 * left reads exactly like a bare street address. An individual's name is
 * never literally a street address, so this is a safe, narrow heuristic
 * for exactly that truncation pattern rather than a broad match. */
function looksLikeTruncatedAddressEntity(upper: string): boolean {
  if (!/^\d/.test(upper.trim())) return false;
  return STREET_TYPE_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(upper));
}

/** True if this looks like an LLC/Corp/government/church/charity/business
 * record rather than a real individual or personal trust. Checks the
 * combined first+last name, since a messy import can land the entity name
 * in either field (see mapRowsToLeads's '—' placeholder for a blank name). */
export function isNonIndividualEntity(firstName: string, lastName: string): boolean {
  // '—' is this app's own placeholder for "no first name" (see
  // mapRowsToLeads) — strip it before checking, or it swallows the
  // address-shaped check below, which specifically needs to see whichever
  // field's *own* text starts with a digit, not the combined pair.
  const first = (firstName ?? '').trim() === '—' ? '' : (firstName ?? '').trim();
  const last = (lastName ?? '').trim() === '—' ? '' : (lastName ?? '').trim();
  const combined = `${first} ${last}`.trim();
  if (!combined) return false; // blank names are a separate, deliberately-untouched case

  const upper = combined.toUpperCase();
  if (TRUST_KEYWORDS.some((kw) => upper.includes(kw))) return false;
  if (ENTITY_KEYWORDS.some((kw) => upper.includes(kw.trim()))) return true;
  if (looksLikeTruncatedAddressEntity(first.toUpperCase()) || looksLikeTruncatedAddressEntity(last.toUpperCase())) return true;
  return false;
}
