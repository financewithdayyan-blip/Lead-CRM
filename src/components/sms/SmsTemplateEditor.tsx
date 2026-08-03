import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useTags } from '@/hooks/useTags';
import { useSaveSmsTemplate, useSmsTemplates } from '@/hooks/useSmsTemplates';
import { MergeTagButtons } from './MergeTagButtons';

/**
 * Saved per-tag bulk SMS messages — Bulk SMS loads these as its starting
 * point, so composing a send is normally just pick leads, glance at the
 * already-written message, and send, rather than retyping it every time.
 */
export function SmsTemplateEditor() {
  const { data: tags = [] } = useTags();
  const { data: templates = [] } = useSmsTemplates();
  const saveTemplate = useSaveSmsTemplate();
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null); // null = Default
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const byTagId = new Map(templates.map((t) => [t.tagId, t]));
  const selectedTag = selectedTagId ? tags.find((t) => t.id === selectedTagId) : null;
  const savedBody = byTagId.get(selectedTagId)?.body ?? '';

  const [body, setBody] = useState(savedBody);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Switching the dropdown swaps in that selection's own saved text rather
  // than carrying over whatever was being edited for the previous one.
  useEffect(() => setBody(savedBody), [selectedTagId, savedBody]);

  const dirty = body !== savedBody;

  async function handleSave() {
    setSaving(true);
    try {
      await saveTemplate.mutateAsync({ tagId: selectedTagId, body });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-text">Bulk SMS templates</div>
          <p className="mt-1 text-[13px] text-text-2">
            Save a message per tag so Bulk SMS opens with it already written. Each lead still gets their own address,
            name, city, etc. filled in — not a generic blast.
          </p>
        </div>
        {tags.length > 0 && (
          <select
            className="input max-w-[200px]"
            value={selectedTagId ?? ''}
            onChange={(e) => setSelectedTagId(e.target.value || null)}
          >
            <option value="">Default</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mt-3 rounded-md border border-border-2 bg-surface-3 p-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="text-[13px] font-semibold text-text">{selectedTag ? `${selectedTag.name} message` : 'Default message'}</div>
          {saved && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-success">
              <Check size={11} /> Saved
            </span>
          )}
        </div>
        <p className="mb-2 text-[11px] text-text-3">
          {selectedTag
            ? 'Used for leads carrying this tag when starting a bulk send. Leave blank to fall back to Default.'
            : 'Used for any lead whose tags have no message of their own.'}
        </p>
        <textarea
          ref={textareaRef}
          className="input min-h-[100px]"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Hi {{first_name}}, this is Bluebird — we buy houses in {{city}} as-is..."
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <MergeTagButtons getTextarea={() => textareaRef.current} value={body} onChange={setBody} />
          <button className="btn btn-primary !px-3 !py-1 text-[12px] shrink-0" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
          </button>
        </div>
      </div>

      {tags.length === 0 && (
        <p className="mt-2 px-1 text-[12px] text-text-3">
          No tags yet — add tags on the Tags panel below, then come back here to give any of them their own message.
        </p>
      )}
    </div>
  );
}
