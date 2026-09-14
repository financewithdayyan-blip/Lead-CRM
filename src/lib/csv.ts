import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { expandStreetSuffix, extractPhones, formatPhone, normalizePhoneDigits, parseAuctionDate } from './utils';
import { isNonIndividualEntity } from './entityDetection';

export interface CsvParseResult {
  headers: string[];
  rows: string[][];
}

function rowsFromParsedData(data: string[][]): CsvParseResult {
  const filtered = data.filter((row) => row.some((c) => (c ?? '').trim().length > 0));
  if (filtered.length < 2) {
    throw new Error('File must have a header row and at least one data row.');
  }
  return { headers: filtered[0].map((h) => (h ?? '').trim()), rows: filtered.slice(1) };
}

export function parseCsvFile(file: File): Promise<CsvParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      complete: (result) => {
        try {
          resolve(rowsFromParsedData(result.data as string[][]));
        } catch (e) {
          reject(e);
        }
      },
      error: reject,
      skipEmptyLines: true,
    });
  });
}

/** .xlsx/.xls — reads the first sheet only, cells coerced to plain strings
 * (raw: false) so a date or number cell comes through already formatted
 * the same way it would from a CSV export, rather than an Excel serial
 * number or a Date object neither mapRowsToLeads nor the auction-date
 * parser expects. */
export function parseXlsxFile(file: File): Promise<CsvParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read the Excel file.'));
    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          reject(new Error('That Excel file has no sheets.'));
          return;
        }
        const sheet = workbook.Sheets[firstSheetName];
        const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' });
        resolve(rowsFromParsedData(data as string[][]));
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Failed to parse the Excel file.'));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

export function isXlsxFile(file: File): boolean {
  return /\.xlsx?$/i.test(file.name);
}

/** Single entry point for either format — picks the parser by file
 * extension so callers don't need to branch themselves. */
export function parseLeadsFile(file: File): Promise<CsvParseResult> {
  return isXlsxFile(file) ? parseXlsxFile(file) : parseCsvFile(file);
}

export const CSV_FIELD_GUESSES: Array<{ key: string; label: string; patterns: RegExp[]; optional: boolean }> = [
  { key: 'name', label: 'First Name', patterns: [/^first.?name|fname|^first$/i, /name|owner|contact|seller/i], optional: false },
  { key: 'lastname', label: 'Last Name', patterns: [/^last.?name|lname|^last$|surname/i], optional: true },
  { key: 'phone', label: 'Phone', patterns: [/phone|cell|mobile|number|tel/i], optional: false },
  { key: 'phone2', label: 'Phone 2', patterns: [/phone.?2|cell.?2|landline|home.?phone|alt.?phone|second.?phone/i], optional: true },
  { key: 'email', label: 'Email', patterns: [/email|e-mail|mail/i], optional: true },
  { key: 'address', label: 'Address', patterns: [/address|addr|\bstreet\b/i], optional: false },
  { key: 'city', label: 'City', patterns: [/\bcity\b|\btown\b/i], optional: true },
  { key: 'state', label: 'State', patterns: [/\bstate\b|\bprovince\b/i], optional: true },
  { key: 'zip', label: 'Zip', patterns: [/\bzip\b|postal/i], optional: true },
  { key: 'beds', label: 'Beds', patterns: [/beds?|br|bedroom/i], optional: true },
  { key: 'baths', label: 'Baths', patterns: [/baths?|ba|bathroom/i], optional: true },
  { key: 'sqft', label: 'Sqft', patterns: [/sqft|sq.?ft|square.?feet|living.?area|size/i], optional: true },
  { key: 'lotsize', label: 'Lot Size', patterns: [/lot.?size|lot.?sqft|lot|acreage|acres/i], optional: true },
  { key: 'proptype', label: 'Property Type', patterns: [/property.?type|prop.?type|type|category/i], optional: true },
  { key: 'auctiondate', label: 'Auction Date', patterns: [/auction.?date|sale.?date|foreclosure.?date|\bauction\b/i], optional: true },
  { key: 'source', label: 'Source', patterns: [/source|lead.?source|campaign|list/i], optional: true },
  { key: 'notes', label: 'Notes', patterns: [/\bnotes?\b|comments?|remarks?|description/i], optional: true },
];

export function guessColumnMapping(headers: string[]): Record<string, number | null> {
  const mapping: Record<string, number | null> = {};
  for (const field of CSV_FIELD_GUESSES) {
    const idx = headers.findIndex((h) => field.patterns.some((p) => p.test(h)));
    mapping[field.key] = idx >= 0 ? idx : null;
  }
  return mapping;
}

export function cellAt(row: string[], idx: number | null): string {
  return idx !== null && row[idx] !== undefined ? row[idx].trim() : '';
}

export interface MappedCsvLead {
  firstName: string;
  lastName: string;
  phone: string;
  phone2: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  beds: string;
  baths: string;
  sqft: string;
  lotSize: string;
  propType: string;
  auctionDate: string;         // ISO date string for the DB
  auctionDateRaw: string;      // original CSV cell value
  auctionDateDisplay: string;  // human-readable parsed date, e.g. "Jul 9, 2026"
  auctionDateWarning: string | null; // non-null when the date looks suspect
  source: string;
  notes: string;
}

export function mapRowsToLeads(rows: string[][], mapping: Record<string, number | null>): MappedCsvLead[] {
  return rows
    .filter((r) => cellAt(r, mapping.name).length > 0 || cellAt(r, mapping.phone).length > 0)
    .map((r) => {
      const rawPhone = cellAt(r, mapping.phone);
      const phones = extractPhones(rawPhone);
      const phone2Col = cellAt(r, mapping.phone2);
      return {
        firstName: cellAt(r, mapping.name) || '—',
        lastName: cellAt(r, mapping.lastname),
        phone: phones[0] ?? '',
        phone2: phone2Col ? formatPhone(phone2Col) : phones[1] ?? '',
        email: cellAt(r, mapping.email),
        address: expandStreetSuffix(cellAt(r, mapping.address)) || '—',
        city: cellAt(r, mapping.city),
        state: cellAt(r, mapping.state),
        zip: cellAt(r, mapping.zip),
        beds: cellAt(r, mapping.beds),
        baths: cellAt(r, mapping.baths),
        sqft: cellAt(r, mapping.sqft),
        lotSize: cellAt(r, mapping.lotsize),
        propType: cellAt(r, mapping.proptype),
        ...(() => {
          const raw = cellAt(r, mapping.auctiondate);
          const parsed = parseAuctionDate(raw);
          return {
            auctionDate: parsed.iso ?? '',
            auctionDateRaw: raw,
            auctionDateDisplay: parsed.display,
            auctionDateWarning: parsed.warning,
          };
        })(),
        source: cellAt(r, mapping.source),
        notes: cellAt(r, mapping.notes),
      };
    });
}

/** Auto-skips LLCs/corporations/government agencies/churches/charities/etc
 * on every import, not just the CSV that prompted this — built from a
 * manual, name-by-name review of a real bad import (see
 * src/lib/entityDetection.ts's own header for the full story). A real
 * individual or a personal trust is never filtered; only records that
 * read as a business/institution rather than a person. */
export function filterOutNonIndividuals(
  mapped: MappedCsvLead[],
): { individuals: MappedCsvLead[]; entityFilteredCount: number } {
  let entityFilteredCount = 0;
  const individuals = mapped.filter((lead) => {
    if (isNonIndividualEntity(lead.firstName, lead.lastName)) {
      entityFilteredCount++;
      return false;
    }
    return true;
  });
  return { individuals, entityFilteredCount };
}

/** Drops rows with no usable phone at all — a lead with a name/address but
 * neither phone nor phone2 blank can't be called or texted, so it's dead
 * weight on every board rather than a real contact. mapRowsToLeads already
 * requires a name OR a phone to keep a row (catching fully blank lines);
 * this catches the "has a name, has no way to reach them" case those don't. */
export function filterOutMissingPhones(
  mapped: MappedCsvLead[],
): { withPhone: MappedCsvLead[]; missingPhoneCount: number } {
  let missingPhoneCount = 0;
  const withPhone = mapped.filter((lead) => {
    if (!lead.phone.trim() && !lead.phone2.trim()) {
      missingPhoneCount++;
      return false;
    }
    return true;
  });
  return { withPhone, missingPhoneCount };
}

/** Matches on Phone Number 1 only — the one this CRM actually calls/texts.
 * A secondary number (phone2, or anything beyond it on the CSV side) is
 * never used for dedup, on either side of the comparison: an existing
 * lead's old phone2 shouldn't silently swallow a genuinely new lead just
 * because it happens to share a number nobody reaches out to. */
export function dedupeAgainstExisting(
  mapped: MappedCsvLead[],
  existing: Array<{ phone: string }>,
): { unique: MappedCsvLead[]; duplicateCount: number } {
  const existingNorm = new Set<string>();
  for (const lead of existing) {
    const digits = normalizePhoneDigits(lead.phone);
    if (digits.length >= 7) existingNorm.add(digits);
  }
  const seenNew = new Set<string>();
  let duplicateCount = 0;
  const unique = mapped.filter((lead) => {
    const digits = normalizePhoneDigits(lead.phone);
    if (digits.length >= 7) {
      if (existingNorm.has(digits) || seenNew.has(digits)) {
        duplicateCount++;
        return false;
      }
      seenNew.add(digits);
    }
    return true;
  });
  return { unique, duplicateCount };
}
