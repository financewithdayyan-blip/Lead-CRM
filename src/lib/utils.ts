import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return raw;
  return `+1${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function extractPhones(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const digitsOnly = raw.replace(/[^0-9]/g, '');
  const chunks: string[] = [];
  for (let i = 0; i + 10 <= digitsOnly.length; i += 10) {
    chunks.push(digitsOnly.slice(i, i + 10));
  }
  if (chunks.length === 0 && digitsOnly.length >= 7) chunks.push(digitsOnly);
  return chunks.map(formatPhone);
}

export function normalizePhoneDigits(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '').slice(-10);
}

export function formatCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Renders a duration in seconds as "3h 24m", "45m", or "<1m". */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return '<1m';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

export function localIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface ParsedAuctionDate {
  iso: string | null;      // YYYY-MM-DD for the DB, null if unparseable
  display: string;         // "Jul 9, 2026" for the import preview
  warning: string | null;  // non-null = flag this row before importing
}

const AUCTION_MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const AUCTION_WEEKDAYS = new Set([
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
  'mon','tue','wed','thu','fri','sat','sun',
]);

/**
 * Parses auction date strings from CSV with year inference and sanity checks.
 * Handles: "Thursday 9 July", "9 July", "July 9th", "9/7/2026", "2026-07-09", etc.
 * When the year is missing, assumes the current year; if that date is past, rolls to next year.
 */
export function parseAuctionDate(raw: string | null | undefined): ParsedAuctionDate {
  const input = (raw ?? '').trim();
  if (!input) return { iso: null, display: '', warning: null };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Strip ordinal suffixes: "9th" → "9", "1st" → "1"
  let s = input.replace(/\b(\d+)(st|nd|rd|th)\b/gi, '$1');
  // Strip weekday names so "Thursday 9 July" becomes "9 July"
  s = s.split(/[\s,]+/).filter(t => t && !AUCTION_WEEKDAYS.has(t.toLowerCase())).join(' ').trim();

  // ── structured formats with explicit year ──────────────────────────────────
  let m: RegExpMatchArray | null;

  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return _finalize(+m[1], +m[2], +m[3], true, today, input);

  // MM/DD/YYYY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return _finalize(+m[3], +m[1], +m[2], true, today, input);

  // YYYY/MM/DD
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return _finalize(+m[1], +m[2], +m[3], true, today, input);

  // MM-DD-YYYY
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return _finalize(+m[3], +m[1], +m[2], true, today, input);

  // ── natural-language tokenizer ─────────────────────────────────────────────
  const tokens = s.split(/[\s,]+/).filter(Boolean);
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;

  for (const tok of tokens) {
    const mo = AUCTION_MONTHS[tok.toLowerCase()];
    if (mo !== undefined) { month = mo; continue; }
    const n = parseInt(tok, 10);
    if (isNaN(n)) continue;
    // Numbers >= 2020 are recognisable explicit years; below that (including
    // the V8-artifact "2001") are treated as unknown and trigger year inference.
    if (n >= 2020) { year = n; continue; }
    if (n >= 1 && n <= 31 && day === null) { day = n; }
  }

  if (day !== null && month !== null) {
    return _finalize(year, month, day, year !== null, today, input);
  }

  return { iso: null, display: input, warning: 'could not parse date' };
}

function _finalize(
  year: number | null,
  month: number,
  day: number,
  yearProvided: boolean,
  today: Date,
  originalInput: string,
): ParsedAuctionDate {
  const cy = today.getFullYear();
  let resolvedYear: number;

  if (!yearProvided || year === null) {
    // Infer year: current year if still future, otherwise next year
    const candidate = new Date(cy, month - 1, day);
    resolvedYear = candidate >= today ? cy : cy + 1;
  } else {
    resolvedYear = year;
  }

  const date = new Date(resolvedYear, month - 1, day);
  // Guard against invalid calendar dates (e.g. Feb 31)
  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { iso: null, display: originalInput, warning: 'invalid date' };
  }

  const iso = localIsoDate(date);
  const display = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const diffMs = date.getTime() - today.getTime();
  let warning: string | null = null;
  if (diffMs < 0) {
    warning = 'check auction date — appears to be in the past';
  } else if (diffMs > 366 * 86400000) {
    warning = 'check auction date — over 12 months out';
  }

  return { iso, display, warning };
}

export function daysUntil(dateIso: string): number {
  const [y, m, d] = dateIso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function initials(firstName: string, lastName: string): string {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || '?';
}

/** The caller's own name for the call script opener: profile full name, else their email username. */
export function callerDisplayName(fullName: string | null | undefined, email: string | null | undefined): string {
  if (fullName && fullName.trim()) return fullName.trim();
  if (email) return email.split('@')[0];
  return '[Your Name]';
}

const STREET_SUFFIX_MAP: Record<string, string> = {
  aly: 'Alley',
  ave: 'Avenue',
  blvd: 'Boulevard',
  cir: 'Circle',
  ct: 'Court',
  cv: 'Cove',
  cswy: 'Causeway',
  dr: 'Drive',
  est: 'Estate',
  expy: 'Expressway',
  ext: 'Extension',
  fwy: 'Freeway',
  hwy: 'Highway',
  is: 'Island',
  jct: 'Junction',
  ln: 'Lane',
  mnr: 'Manor',
  pkwy: 'Parkway',
  pl: 'Place',
  plz: 'Plaza',
  pt: 'Point',
  rd: 'Road',
  rdg: 'Ridge',
  sq: 'Square',
  st: 'Street',
  ter: 'Terrace',
  trl: 'Trail',
  tpke: 'Turnpike',
  vly: 'Valley',
  xing: 'Crossing',
};

// Directional suffixes (e.g. "123 Main Dr SW") should stay abbreviated - only
// the actual street-type word gets expanded.
const DIRECTIONALS = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);

/**
 * Expands a street suffix abbreviation (Dr -> Drive, Ave -> Avenue, St ->
 * Street, Ct -> Court, ...) at the end of a street address, skipping over a
 * trailing directional (SW, NE, ...) if present. Only touches the one
 * suffix word - everything else in the address is left untouched, so this
 * is safe to run on a plain street-address value without misreading city
 * names or state codes elsewhere in a fuller address string.
 */
export function expandStreetSuffix(address: string | null | undefined): string {
  if (!address) return address ?? '';
  const parts = address.split(/(\s+)/);
  const wordIndexes: number[] = [];
  parts.forEach((p, i) => {
    if (p.trim().length > 0) wordIndexes.push(i);
  });

  for (let k = wordIndexes.length - 1; k >= 0; k--) {
    const idx = wordIndexes[k];
    const match = parts[idx].match(/^([A-Za-z]+)(\W*)$/);
    if (!match) continue;
    const [, letters, trailingPunct] = match;
    const lower = letters.toLowerCase();
    if (DIRECTIONALS.has(lower)) continue;
    const expanded = STREET_SUFFIX_MAP[lower];
    if (expanded) parts[idx] = expanded + trailingPunct;
    break;
  }
  return parts.join('');
}

/** Supabase/Postgrest errors are plain objects with a `message`, not `Error` instances. */
export function getErrorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}
