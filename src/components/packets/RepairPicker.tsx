import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { REPAIR_CATALOG } from '@/lib/repairCatalog';

const MAX_SUGGESTIONS = 30;

/** Search-as-you-type picker for adding a repair line item — same
 * search/keyboard-nav/click-outside pattern as GeoMultiSelect, adapted for
 * "pick one, it becomes a new line" instead of chips. Typing something not
 * in the catalog still works (real deals need repairs this list doesn't
 * cover) via an "Add ... as custom item" fallback row. Already-added items
 * are excluded from suggestions so the same repair can't be picked twice. */
export function RepairPicker({ existingItems, onAdd }: { existingItems: string[]; onAdd: (item: string) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const existingLower = useMemo(() => new Set(existingItems.map((i) => i.trim().toLowerCase())), [existingItems]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = REPAIR_CATALOG.filter((r) => !existingLower.has(r.label.toLowerCase()) && (!q || r.label.toLowerCase().includes(q)));
    pool.sort((a, b) => {
      if (!q) return a.group === b.group ? a.label.localeCompare(b.label) : a.group.localeCompare(b.group);
      const aPrefix = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bPrefix = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      return aPrefix !== bPrefix ? aPrefix - bPrefix : a.label.localeCompare(b.label);
    });
    return pool.slice(0, MAX_SUGGESTIONS);
  }, [query, existingLower]);

  const exactMatch = matches.some((m) => m.label.toLowerCase() === query.trim().toLowerCase());
  const showCustomRow = query.trim().length > 0 && !exactMatch && !existingLower.has(query.trim().toLowerCase());

  function commit(label: string) {
    const trimmed = label.trim();
    if (!trimmed || existingLower.has(trimmed.toLowerCase())) return;
    onAdd(trimmed);
    setQuery('');
    setHighlight(0);
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const rowCount = matches.length + (showCustomRow ? 1 : 0);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, rowCount - 1));
      setOpen(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight < matches.length && matches[highlight]) commit(matches[highlight].label);
      else if (query.trim()) commit(query);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        className="input !py-1.5 text-[13px]"
        placeholder="Search repairs — e.g. Roof, HVAC, Mold…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="absolute left-0 right-0 z-10 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-popover">
          {matches.length === 0 && !showCustomRow ? (
            <div className="px-3 py-2 text-[12.5px] text-text-3">No matching repairs.</div>
          ) : (
            <>
              {(() => {
                let lastGroup: string | null = null;
                return matches.map((m, i) => {
                  const Icon = m.icon;
                  const groupHeader = m.group !== lastGroup;
                  lastGroup = m.group;
                  return (
                    <div key={m.label}>
                      {groupHeader && (
                        <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">{m.group}</div>
                      )}
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => commit(m.label)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${
                          i === highlight ? 'bg-surface-3 text-text' : 'text-text-2 hover:bg-surface-3'
                        }`}
                      >
                        <Icon size={14} className="shrink-0 text-text-3" />
                        {m.label}
                      </button>
                    </div>
                  );
                });
              })()}
              {showCustomRow && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(query)}
                  className={`flex w-full items-center gap-2 border-t border-border px-3 py-1.5 text-left text-[13px] ${
                    highlight === matches.length ? 'bg-surface-3 text-text' : 'text-text-2 hover:bg-surface-3'
                  }`}
                >
                  <Plus size={14} className="shrink-0 text-text-3" />
                  Add "{query.trim()}" as custom item
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
