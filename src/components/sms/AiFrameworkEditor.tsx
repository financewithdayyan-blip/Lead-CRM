import { useEffect, useState } from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { useTags } from '@/hooks/useTags';
import {
  DEFAULT_FRAMEWORK,
  LIEN_TAG_NAMES,
  useAiReplyConfigs,
  useSaveAiReplyConfig,
} from '@/hooks/useAiReplyConfig';
import { useAiSettings, useSetAiEnabled } from '@/hooks/useAiSettings';
import { TagPill } from '@/components/ui/TagPill';

/** One framework text box — Default or a specific tag — with its own save state. */
function FrameworkBox({
  title,
  hint,
  initialValue,
  placeholder,
  onSave,
}: {
  title: React.ReactNode;
  hint?: string;
  initialValue: string;
  placeholder?: string;
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(initialValue);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setText(initialValue), [initialValue]);

  const dirty = text !== initialValue;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(text);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-border-2 bg-surface-3 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-text">{title}</div>
        {saved && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-success">
            <Check size={11} /> Saved
          </span>
        )}
      </div>
      {hint && <p className="mb-2 text-[11px] text-text-3">{hint}</p>}
      <textarea
        className="input min-h-[140px] font-mono text-[12.5px] leading-relaxed"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-2 flex justify-end">
        <button className="btn btn-primary !px-3 !py-1 text-[12px]" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
        </button>
      </div>
    </div>
  );
}

export function AiFrameworkEditor() {
  const { data: tags = [] } = useTags();
  const { data: configs = [] } = useAiReplyConfigs();
  const saveConfig = useSaveAiReplyConfig();
  const { data: aiSettings } = useAiSettings();
  const setAiEnabled = useSetAiEnabled();
  const [expandedTagId, setExpandedTagId] = useState<string | null>(null);

  const byTagId = new Map(configs.map((c) => [c.tagId, c]));
  const defaultConfig = configs.find((c) => c.tagId === null);
  const enabled = aiSettings?.autoReplyEnabled ?? true;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-text">AI auto-reply</div>
          <p className="mt-1 text-[13px] text-text-2">
            {enabled
              ? 'On — inbound texts are drafted and sent automatically, subject to each lead\'s own pause state.'
              : 'Off — inbound texts are still logged and leads still move across the pipeline, but nothing is drafted or sent. Reply manually from each lead\'s SMS tab.'}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          onClick={() => setAiEnabled.mutate(!enabled)}
          disabled={setAiEnabled.isPending}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-border-2'}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`}
          />
        </button>
      </div>

      <div className="my-4 border-t border-border" />

      <div className="text-sm font-semibold text-text">Qualification frameworks</div>
      <p className="mt-1 text-[13px] text-text-2">
        What the AI tries to establish before handing a lead to a human. Each tag can have its own framework; a lead
        whose tags have none saved uses Default.
      </p>

      <div className="mt-3 space-y-2">
        <FrameworkBox
          title="Default"
          hint="Applies to any lead whose tags don't have a framework of their own."
          initialValue={defaultConfig?.framework ?? ''}
          placeholder={DEFAULT_FRAMEWORK}
          onSave={(text) => saveConfig.mutateAsync({ tagId: null, framework: text })}
        />

        {tags.length === 0 ? (
          <div className="px-1 py-3 text-[12px] text-text-3">
            No tags yet — add tags on the Tags panel below, then come back here to give any of them their own
            framework.
          </div>
        ) : (
          tags.map((tag) => {
            const config = byTagId.get(tag.id);
            const isLien = LIEN_TAG_NAMES.some((n) => n.toLowerCase() === tag.name.toLowerCase());
            const expanded = expandedTagId === tag.id;
            return (
              <div key={tag.id} className="rounded-md border border-border-2">
                <button
                  onClick={() => setExpandedTagId(expanded ? null : tag.id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                >
                  <div className="flex items-center gap-2">
                    <TagPill tag={tag} />
                    {config?.framework ? (
                      <span className="text-[11px] text-text-3">custom framework saved</span>
                    ) : (
                      <span className="text-[11px] text-text-3">using Default</span>
                    )}
                    {isLien && (
                      <span
                        className="rounded-full bg-warning-dim px-1.5 py-0.5 text-[10px] font-semibold text-warning"
                        title="This tag always asks for mortgage balance and how far behind on payments too, in addition to whatever framework applies — that's a fixed rule, not something set here."
                      >
                        + mortgage question
                      </span>
                    )}
                  </div>
                  <ChevronDown size={14} className={`text-text-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
                {expanded && (
                  <div className="border-t border-border-2 p-3">
                    <FrameworkBox
                      title={`${tag.name} framework`}
                      hint="Leave blank to fall back to Default."
                      initialValue={config?.framework ?? ''}
                      placeholder={DEFAULT_FRAMEWORK}
                      onSave={(text) => saveConfig.mutateAsync({ tagId: tag.id, framework: text })}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
