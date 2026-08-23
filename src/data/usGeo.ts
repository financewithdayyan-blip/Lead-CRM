import raw from './usGeo.json';

/** All 50 states + DC, each with every incorporated city/town and every
 *  county, sourced from GeoNames (via the `country-state-city` package) and
 *  the US Census county list. ~19,500 cities / 3,143 counties — verified
 *  against known per-state county counts (TX 254, GA 159, CA 58, LA 64
 *  parishes) before shipping. */
interface UsGeoData {
  states: { code: string; name: string }[];
  citiesByState: Record<string, string[]>;
  countiesByState: Record<string, string[]>;
}

const data = raw as UsGeoData;

export const US_STATE_OPTIONS = data.states;
export const US_STATE_NAMES = data.states.map((s) => s.name);

const NAME_TO_CODE = new Map(data.states.map((s) => [s.name.toLowerCase(), s.code]));
const CODE_SET = new Set(data.states.map((s) => s.code));

/** Best-effort match of a free-typed state (full name, abbreviation, any
 *  case) to its 2-letter code — leads.state / deal_packets.state is a plain
 *  text input, never constrained to one format. */
export function normalizeStateToCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length === 2) {
    const code = trimmed.toUpperCase();
    return CODE_SET.has(code) ? code : null;
  }
  return NAME_TO_CODE.get(trimmed.toLowerCase()) ?? null;
}

function codesForNames(stateNames: string[]): string[] {
  return stateNames.map((n) => NAME_TO_CODE.get(n.trim().toLowerCase())).filter((c): c is string => !!c);
}

/** Cities for the given state names, deduped and sorted — all states
 *  nationwide when none are selected yet. */
export function citiesForStates(stateNames: string[]): string[] {
  const codes = stateNames.length > 0 ? codesForNames(stateNames) : Object.keys(data.citiesByState);
  const set = new Set<string>();
  for (const code of codes) for (const city of data.citiesByState[code] ?? []) set.add(city);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Counties for the given state names, deduped and sorted — all states
 *  nationwide when none are selected yet. */
export function countiesForStates(stateNames: string[]): string[] {
  const codes = stateNames.length > 0 ? codesForNames(stateNames) : Object.keys(data.countiesByState);
  const set = new Set<string>();
  for (const code of codes) for (const county of data.countiesByState[code] ?? []) set.add(county);
  return [...set].sort((a, b) => a.localeCompare(b));
}

const CODE_TO_NAME = new Map(data.states.map((s) => [s.code, s.name]));

/** "City, ST" labels for the Disposition search box, so typing "Philadelphia"
 *  unambiguously picks one state's Philadelphia rather than matching a bare
 *  city name that exists in several states. State names are searchable
 *  as-is (no state has a comma in it, so there's no format collision). */
export function cityStateOptions(): string[] {
  const out: string[] = [];
  for (const code of Object.keys(data.citiesByState)) {
    for (const city of data.citiesByState[code]) out.push(`${city}, ${code}`);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export type SearchTarget = { kind: 'state'; stateName: string } | { kind: 'city'; cityName: string; stateName: string };

/** Parses a selection from the combined state-name + "City, ST" option list
 *  built by `cityStateOptions()` plus `US_STATE_NAMES` back into a
 *  structured target the buyer-matching logic can use. */
export function resolveSearchTarget(label: string): SearchTarget | null {
  if (NAME_TO_CODE.has(label.toLowerCase())) return { kind: 'state', stateName: label };
  const idx = label.lastIndexOf(', ');
  if (idx === -1) return null;
  const cityName = label.slice(0, idx);
  const code = label.slice(idx + 2);
  const stateName = CODE_TO_NAME.get(code);
  return stateName ? { kind: 'city', cityName, stateName } : null;
}
