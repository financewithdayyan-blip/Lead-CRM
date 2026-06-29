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

export function localIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseFlexibleDate(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return localIsoDate(d);
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
