const MERGE_TAGS: { token: string; label: string }[] = [
  { token: '{{first_name}}', label: 'First name' },
  { token: '{{last_name}}', label: 'Last name' },
  { token: '{{address}}', label: 'Address' },
  { token: '{{city}}', label: 'City' },
  { token: '{{state}}', label: 'State' },
  { token: '{{zip}}', label: 'Zip' },
];

/**
 * Clickable pills that insert a {{token}} at the cursor — render() in
 * send-sms already fills these in per-lead; this just makes that fact
 * discoverable instead of relying on a caption underneath the textarea.
 */
export function MergeTagButtons({
  getTextarea,
  value,
  onChange,
}: {
  getTextarea: () => HTMLTextAreaElement | null;
  value: string;
  onChange: (next: string) => void;
}) {
  function insert(token: string) {
    const el = getTextarea();
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);

    // The textarea's value hasn't re-rendered with `next` yet on this tick,
    // so the cursor has to be restored on the next one.
    requestAnimationFrame(() => {
      const el2 = getTextarea();
      if (!el2) return;
      el2.focus();
      const pos = start + token.length;
      el2.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="flex flex-wrap gap-1">
      {MERGE_TAGS.map((t) => (
        <button
          key={t.token}
          type="button"
          onClick={() => insert(t.token)}
          className="rounded-full border border-border-2 bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-text-2 hover:border-primary hover:text-primary"
          title={`Insert ${t.token}`}
        >
          + {t.label}
        </button>
      ))}
    </div>
  );
}
