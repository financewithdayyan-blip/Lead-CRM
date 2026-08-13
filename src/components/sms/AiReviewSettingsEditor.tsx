import { useAiReviewSettings, useSaveAiReviewSettings } from '@/hooks/useAiReviewSettings';

/** Turns the nightly AI reply self-review job on or off. It runs quietly —
 * no report is shown here or anywhere else by design — this is purely a
 * cost switch, not a way to see what it found. */
export function AiReviewSettingsEditor() {
  const { data: settings } = useAiReviewSettings();
  const save = useSaveAiReviewSettings();

  const enabled = settings?.enabled ?? true;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-text">AI reply self-review</div>
          <p className="mt-1 text-[13px] text-text-2">
            {enabled
              ? 'On — once a night, reads through the AI\'s handled conversations looking for real mistakes and quietly tightens its own rules when it finds a repeatable one. Never touches price or opt-out behavior. Runs on Claude Opus 5, roughly $0.40-0.80 a night.'
              : 'Off — the nightly review won\'t run, so it costs nothing until turned back on. The AI still replies normally either way, it just won\'t learn from that day\'s conversations.'}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          onClick={() => save.mutate(!enabled)}
          disabled={save.isPending}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-border-2'}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`}
          />
        </button>
      </div>
    </div>
  );
}
