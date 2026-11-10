import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useBulkCreateCashBuyers, type CashBuyerInput } from '@/hooks/useCashBuyers';
import { cellAt, parseLeadsFile, type CsvParseResult } from '@/lib/csv';
import { getErrorMessage } from '@/lib/utils';

const FIELD_GUESSES: Array<{ key: string; label: string; patterns: RegExp[]; optional: boolean }> = [
  { key: 'name', label: 'Name / Company', patterns: [/name|company|buyer/i], optional: false },
  { key: 'phone', label: 'Phone', patterns: [/phone|cell|mobile|number|tel/i], optional: true },
  { key: 'email', label: 'Email', patterns: [/email|e-mail|mail/i], optional: true },
  { key: 'city', label: 'City', patterns: [/\bcity\b|\btown\b/i], optional: true },
  { key: 'state', label: 'State', patterns: [/\bstate\b|\bprovince\b/i], optional: true },
  { key: 'pricemin', label: 'Price Min', patterns: [/price.?min|min.?price|min.?budget/i], optional: true },
  { key: 'pricemax', label: 'Price Max', patterns: [/price.?max|max.?price|max.?budget/i], optional: true },
];

function guessMapping(headers: string[]): Record<string, number | null> {
  const mapping: Record<string, number | null> = {};
  for (const f of FIELD_GUESSES) {
    const idx = headers.findIndex((h) => f.patterns.some((p) => p.test(h)));
    mapping[f.key] = idx >= 0 ? idx : null;
  }
  return mapping;
}

type Step = 'upload' | 'mapping';

/** A small, buyer-specific CSV/Excel importer — deliberately not a reuse of
 *  ImportCsvModal (leads), which carries lead-only machinery (dedupe
 *  against pipeline stage, entity/non-individual filtering, auction-date
 *  parsing) that doesn't apply to a buyer roster at all. Reuses only the
 *  generic file-parsing utilities from lib/csv. */
export function ImportBuyersCsvModal({ onClose }: { onClose: () => void }) {
  const bulkCreate = useBulkCreateCashBuyers();
  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    try {
      const result = await parseLeadsFile(file);
      setParsed(result);
      setMapping(guessMapping(result.headers));
      setStep('mapping');
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to parse the file.'));
    }
  }

  const rows: CashBuyerInput[] = (parsed?.rows ?? [])
    .map((row) => {
      const name = cellAt(row, mapping.name).trim();
      if (!name) return null;
      const priceMinRaw = cellAt(row, mapping.pricemin).replace(/[^0-9.]/g, '');
      const priceMaxRaw = cellAt(row, mapping.pricemax).replace(/[^0-9.]/g, '');
      const input: CashBuyerInput = {
        name,
        phone: cellAt(row, mapping.phone).trim() || null,
        email: cellAt(row, mapping.email).trim() || null,
        facebookUrl: null,
        marketStates: cellAt(row, mapping.state).trim() ? [cellAt(row, mapping.state).trim()] : [],
        marketCounties: [],
        marketCities: cellAt(row, mapping.city).trim() ? [cellAt(row, mapping.city).trim()] : [],
        propertyTypes: [],
        buyerTypes: [],
        priceMin: priceMinRaw ? Number(priceMinRaw) : null,
        priceMax: priceMaxRaw ? Number(priceMaxRaw) : null,
        minBeds: null,
        minBaths: null,
        condition: null,
        dealTypes: [],
        notes: null,
        status: 'active',
      };
      return input;
    })
    .filter((r): r is CashBuyerInput => r !== null);

  async function handleImport() {
    setError(null);
    try {
      await bulkCreate.mutateAsync(rows);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to import buyers.'));
    }
  }

  return (
    <Modal open onClose={onClose} title="Import Cash Buyers" width="lg">
      {error && <div className="mb-4 rounded-md bg-danger-dim px-3 py-2 text-[13px] text-danger">{error}</div>}

      {step === 'upload' && (
        <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-2 text-text-3 hover:border-primary hover:text-primary">
          <Upload size={24} />
          <span className="text-sm">Click to choose a CSV or Excel file</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </label>
      )}

      {step === 'mapping' && parsed && (
        <div className="space-y-4">
          <div className="text-[13px] text-text-3">{parsed.rows.length} rows detected. Map your columns below.</div>
          <div className="grid grid-cols-2 gap-3">
            {FIELD_GUESSES.map((field) => (
              <div key={field.key}>
                <label className="label">
                  {field.label} {!field.optional && <span className="text-danger">*</span>}
                </label>
                <select
                  className="input"
                  value={mapping[field.key] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value === '' ? null : Number(e.target.value) }))}
                >
                  {field.optional && <option value="">-- none --</option>}
                  {parsed.headers.map((h, idx) => (
                    <option key={idx} value={idx}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-border bg-surface-3 p-3 text-[13px]">
            {rows.length} buyer{rows.length === 1 ? '' : 's'} will be imported.
            {parsed.rows.length - rows.length > 0 && (
              <div className="mt-1 text-warning">{parsed.rows.length - rows.length} row(s) skipped — no name column mapped.</div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={() => setStep('upload')}>
              Back
            </button>
            <button className="btn btn-primary" disabled={bulkCreate.isPending || rows.length === 0} onClick={handleImport}>
              Import {rows.length} buyer{rows.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
