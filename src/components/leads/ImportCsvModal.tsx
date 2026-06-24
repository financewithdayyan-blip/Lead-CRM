import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useBulkCreateLeads, useLeads } from '@/hooks/useLeads';
import { useCreateTag, useTags, nextTagColor } from '@/hooks/useTags';
import { CSV_FIELD_GUESSES, cellAt, dedupeAgainstExisting, guessColumnMapping, mapRowsToLeads, parseCsvFile, type CsvParseResult } from '@/lib/csv';

type Step = 'upload' | 'mapping' | 'tags';

export function ImportCsvModal({ onClose, targetUserId }: { onClose: () => void; targetUserId?: string }) {
  const { data: existingLeads = [] } = useLeads(targetUserId);
  const { data: tags = [] } = useTags(targetUserId);
  const createTag = useCreateTag();
  const bulkCreate = useBulkCreateLeads();

  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [batchSource, setBatchSource] = useState('');
  const [batchState, setBatchState] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    try {
      const result = await parseCsvFile(file);
      setParsed(result);
      setMapping(guessColumnMapping(result.headers));
      setStep('mapping');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV.');
    }
  }

  const previewMapped = parsed ? mapRowsToLeads(parsed.rows, mapping) : [];
  const { unique, duplicateCount } = dedupeAgainstExisting(previewMapped, existingLeads);

  async function handleImport() {
    setError(null);
    try {
      await bulkCreate.mutateAsync(
        unique.map((m) => ({
          ...(targetUserId ? { userId: targetUserId } : {}),
          firstName: m.firstName,
          lastName: m.lastName,
          phone: m.phone,
          phone2: m.phone2 || null,
          email: m.email || null,
          address: m.address,
          beds: m.beds ? Number(m.beds) : null,
          baths: m.baths ? Number(m.baths) : null,
          sqft: m.sqft ? Number(m.sqft) : null,
          lotSize: m.lotSize || null,
          propType: m.propType || null,
          source: m.source || batchSource || null,
          state: batchState || null,
          stage: 'new' as const,
          rating: 0,
          tagIds: selectedTagIds,
        })),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import leads.');
    }
  }

  async function handleCreateTag() {
    if (!newTagName.trim()) return;
    setError(null);
    try {
      const color = nextTagColor(tags.length);
      const tag = await createTag.mutateAsync({
        name: newTagName.trim(),
        colorBg: color.bg,
        colorText: color.text,
        ...(targetUserId ? { userId: targetUserId } : {}),
      });
      setSelectedTagIds((prev) => [...prev, tag.id]);
      setNewTagName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tag.');
    }
  }

  return (
    <Modal open onClose={onClose} title="Import Leads from CSV" width="lg">
      {error && <div className="mb-4 rounded-md bg-danger-dim px-3 py-2 text-[13px] text-danger">{error}</div>}

      {step === 'upload' && (
        <div>
          <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-2 text-text-3 hover:border-primary hover:text-primary">
            <Upload size={24} />
            <span className="text-sm">Click to choose a CSV file</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </label>
        </div>
      )}

      {step === 'mapping' && parsed && (
        <div className="space-y-4">
          <div className="text-[13px] text-text-3">{parsed.rows.length} rows detected. Map your columns below.</div>
          <div className="grid grid-cols-2 gap-3">
            {CSV_FIELD_GUESSES.map((field) => (
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
          <div className="rounded-md border border-border bg-surface-3 p-2 text-[12px] text-text-3">
            Preview: {cellAt(parsed.rows[0], mapping.name)} · {cellAt(parsed.rows[0], mapping.phone)} · {cellAt(parsed.rows[0], mapping.address)}
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={() => setStep('upload')}>
              Back
            </button>
            <button className="btn btn-primary" onClick={() => setStep('tags')}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 'tags' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Source (applies to whole import)</label>
              <input className="input" value={batchSource} onChange={(e) => setBatchSource(e.target.value)} placeholder="e.g. March cold list" />
            </div>
            <div>
              <label className="label">State</label>
              <input className="input" value={batchState} onChange={(e) => setBatchState(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label">Tag these leads</label>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTagIds((prev) => (prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id]))}
                  style={{ backgroundColor: t.colorBg, color: t.colorText, opacity: selectedTagIds.includes(t.id) ? 1 : 0.4 }}
                  className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                >
                  {selectedTagIds.includes(t.id) ? '✓ ' : ''}
                  {t.name}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input className="input" placeholder="New tag name" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} />
              <button className="btn" onClick={handleCreateTag}>
                Add tag
              </button>
            </div>
          </div>

          <div className="rounded-md border border-border bg-surface-3 p-3 text-[13px]">
            <div className="text-text">
              {unique.length} new lead{unique.length !== 1 ? 's' : ''} will be imported.
            </div>
            {duplicateCount > 0 && <div className="mt-1 text-warning">{duplicateCount} duplicate(s) skipped (matched by phone number).</div>}
          </div>

          <div className="flex justify-end gap-2">
            <button className="btn" onClick={() => setStep('mapping')}>
              Back
            </button>
            <button disabled={bulkCreate.isPending || unique.length === 0} className="btn btn-primary" onClick={handleImport}>
              Import {unique.length} lead{unique.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
