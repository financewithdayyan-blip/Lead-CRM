import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';

const MAX_SUGGESTIONS = 40;

// "Manchester, NH and Lawrence, MA" or "Dallas • Arlington • Grapevine" or a
// paste of several cities separated by pins/arrows should become several
// chips, not one giant string — split on the common separators instead of
// swallowing the whole thing whenever there's no exact dropdown match.
const SEPARATOR = /,|•|📍|→|\s+and\s+/gi;

/** Search-as-you-type multi-select with removable chips, built for
 *  state/county/city pickers where the option list can run into the
 *  thousands (too many to ever render as a checkbox list or a native
 *  <select>). Typing a value with no matching option and pressing Enter
 *  adds it as a free-form entry — county/city datasets only cover official
 *  incorporated places, so a neighborhood name like "Buckhead" that isn't
 *  its own municipality still needs a way in. */
export function GeoMultiSelect({
  label,
  placeholder,
  options,
  selected,
  onChange,
  hint,
}: {
  label: string;
  placeholder?: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  hint?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const selectedSet = useMemo(() => new Set(selected.map((s) => s.toLowerCase())), [selected]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? options.filter((o) => o.toLowerCase().includes(q) && !selectedSet.has(o.toLowerCase())) : [];
    // Prefix matches first, then everything else, both alphabetical within their group.
    pool.sort((a, b) => {
      const aPrefix = a.toLowerCase().startsWith(q) ? 0 : 1;
      const bPrefix = b.toLowerCase().startsWith(q) ? 0 : 1;
      return aPrefix !== bPrefix ? aPrefix - bPrefix : a.localeCompare(b);
    });
    return pool.slice(0, MAX_SUGGESTIONS);
  }, [options, query, selectedSet]);

  function add(value: string) {
    const trimmed = value.trim();
    if (!trimmed || selectedSet.has(trimmed.toLowerCase())) return;
    onChange([...selected, trimmed]);
    setQuery('');
    setHighlight(0);
    setOpen(false);
  }

  const rawSegments = useMemo(
    () => query.split(SEPARATOR).map((s) => s.trim()).filter(Boolean),
    [query],
  );

  function addRaw(raw: string) {
    const segments = raw
      .split(SEPARATOR)
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) return;
    const next = [...selected];
    const seenLower = new Set(next.map((s) => s.toLowerCase()));
    for (const seg of segments) {
      if (seenLower.has(seg.toLowerCase())) continue;
      const canonical = options.find((o) => o.toLowerCase() === seg.toLowerCase());
      const value = canonical ?? seg;
      next.push(value);
      seenLower.add(value.toLowerCase());
    }
    onChange(next);
    setQuery('');
    setHighlight(0);
    setOpen(false);
  }

  function remove(value: string) {
    onChange(selected.filter((s) => s.toLowerCase() !== value.toLowerCase()));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
      setOpen(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[highlight]) add(matches[highlight]);
      else if (query.trim()) addRaw(query);
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && !query && selected.length > 0) {
      remove(selected[selected.length - 1]);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <label className="label">{label}</label>
      {selected.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded-full bg-primary-dim px-2.5 py-0.5 text-[11px] font-medium text-primary-text"
            >
              {s}
              <button type="button" onClick={() => remove(s)} className="opacity-70 hover:opacity-100">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className="input"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {hint && <p className="mt-1 text-[11px] text-text-3">{hint}</p>}
      {open && query.trim() && (
        <div className="absolute left-0 right-0 z-10 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-white py-1 shadow-popover">
          {matches.length > 0 ? (
            matches.map((m, i) => (
              <button
                key={m}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(m)}
                className={`block w-full px-3 py-1.5 text-left text-[13px] ${i === highlight ? 'bg-surface-3 text-text' : 'text-text-2 hover:bg-surface-3'}`}
              >
                {m}
              </button>
            ))
          ) : (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addRaw(query)}
              className="block w-full px-3 py-1.5 text-left text-[13px] text-text-2 hover:bg-surface-3"
            >
              {rawSegments.length > 1 ? `Add ${rawSegments.length} as separate entries: ${rawSegments.join(', ')}` : `Add "${rawSegments[0] ?? query.trim()}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
