import Papa from 'papaparse';
import { extractPhones, formatPhone, normalizePhoneDigits } from './utils';

export interface CsvParseResult {
  headers: string[];
  rows: string[][];
}

export function parseCsvFile(file: File): Promise<CsvParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      complete: (result) => {
        const data = (result.data as string[][]).filter((row) => row.some((c) => (c ?? '').trim().length > 0));
        if (data.length < 2) {
          reject(new Error('CSV must have a header row and at least one data row.'));
          return;
        }
        resolve({ headers: data[0].map((h) => (h ?? '').trim()), rows: data.slice(1) });
      },
      error: reject,
      skipEmptyLines: true,
    });
  });
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
  { key: 'source', label: 'Source', patterns: [/source|lead.?source|campaign|list/i], optional: true },
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
  source: string;
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
        address: cellAt(r, mapping.address) || '—',
        city: cellAt(r, mapping.city),
        state: cellAt(r, mapping.state),
        zip: cellAt(r, mapping.zip),
        beds: cellAt(r, mapping.beds),
        baths: cellAt(r, mapping.baths),
        sqft: cellAt(r, mapping.sqft),
        lotSize: cellAt(r, mapping.lotsize),
        propType: cellAt(r, mapping.proptype),
        source: cellAt(r, mapping.source),
      };
    });
}

export function dedupeAgainstExisting(
  mapped: MappedCsvLead[],
  existing: Array<{ phone: string; phone2: string | null }>,
): { unique: MappedCsvLead[]; duplicateCount: number } {
  const existingNorm = new Set<string>();
  for (const lead of existing) {
    for (const p of [lead.phone, lead.phone2]) {
      const digits = normalizePhoneDigits(p);
      if (digits.length >= 7) existingNorm.add(digits);
    }
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
