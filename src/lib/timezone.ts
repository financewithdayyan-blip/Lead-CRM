/** Primary IANA timezone for each US state/territory — the zone most of that
 * state's population (and address data) actually falls in. Mirrors the copy
 * of this map kept in supabase/functions/ai-reply/index.ts, which is what
 * resolves the seller's zone when converting a spoken callback time into a
 * real UTC instant at storage time. */
const STATE_TIMEZONE: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  ID: 'America/Denver', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver', PR: 'America/Puerto_Rico',
};

export const PAKISTAN_TIME_ZONE = 'Asia/Karachi';

/** Resolves a lead's property address to a US IANA timezone. Falls back to
 * pulling a 2-letter state code off the tail of the free-text address when
 * the `state` field itself wasn't captured. Returns null (not a guess) when
 * neither source yields a real US state — callers should treat that as
 * "zone unknown" rather than silently assuming one. */
export function resolveUsTimeZone(state: string | null | undefined, address?: string | null): string | null {
  const normalized = (state ?? '').trim().toUpperCase();
  if (normalized && STATE_TIMEZONE[normalized]) return STATE_TIMEZONE[normalized];
  const fromAddress = (address ?? '').match(/\b([A-Z]{2})\b\s*\d{5}?(-\d{4})?\s*$/i)?.[1]?.toUpperCase();
  if (fromAddress && STATE_TIMEZONE[fromAddress]) return STATE_TIMEZONE[fromAddress];
  return null;
}

/** "Aug 10, 8:00 PM PKT" style — a real UTC instant rendered in the given
 * IANA zone, with its abbreviation so it's never ambiguous which clock it's
 * on. */
export function formatInZone(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  });
}

/** "Aug 10, 8:00 PM", no zone abbreviation — for Pakistan time specifically,
 * where ICU's 'short' timeZoneName often renders as "GMT+5" rather than a
 * real abbreviation. Pakistan doesn't observe DST, so a hardcoded "PKT"
 * suffix is always correct without needing ICU to resolve one. */
export function formatPakistanTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: PAKISTAN_TIME_ZONE,
  });
}

/** Same as formatInZone but without the date — for a compact secondary line
 * next to a primary timestamp that already shows the date. */
export function formatTimeInZone(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  });
}
