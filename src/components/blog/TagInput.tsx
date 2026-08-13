import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

/** Free-text chip input producing a plain string[] — deliberately not the
 * CRM's relational lead-tagging system (TagPill/Tag in src/types/domain.ts,
 * backed by a `tags` table). Blog tags are simple strings on
 * blog_posts.tags, a different, simpler concept; this borrows TagPill's
 * visual language without importing it. */
export function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('');

  function commitDraft() {
    const value = draft.trim();
    setDraft('');
    if (!value) return;
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) return;
    onChange([...tags, value]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border-2 bg-surface px-2 py-1.5">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
          {tag}
          <button type="button" onClick={() => onChange(tags.filter((t) => t !== tag))} className="opacity-70 hover:opacity-100">
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        className="min-w-[120px] flex-1 border-none bg-transparent py-1 text-[13px] outline-none"
        placeholder={tags.length ? 'Add another…' : 'Add tags, press Enter'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commitDraft}
      />
    </div>
  );
}
