import { useMemo, useState } from 'react';
import type { LeadOption } from '@/hooks/useGeneratedLois';

export function leadLabel(l: LeadOption) {
  const name = `${l.firstName} ${l.lastName}`.trim() || 'Unnamed lead';
  return `${name}${l.address ? ` — ${l.address}` : ''}`;
}

/** Simple filtered dropdown — no dedicated lead-picker component exists
 * elsewhere in the app to reuse, so this one's shared across Blue Docs'
 * LOI generator and contract generator instead of duplicated per tab. */
export function LeadPicker({
  leads,
  selected,
  onSelect,
}: {
  leads: LeadOption[];
  selected: LeadOption | null;
  onSelect: (lead: LeadOption) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leads.slice(0, 30);
    return leads
      .filter((l) => `${l.firstName} ${l.lastName} ${l.address ?? ''} ${l.phone ?? ''}`.toLowerCase().includes(q))
      .slice(0, 30);
  }, [leads, query]);

  return (
    <div className="relative">
      <input
        className="input"
        placeholder="Search a lead by name, address, or phone…"
        value={open ? query : selected ? leadLabel(selected) : query}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-white shadow-popover">
          {filtered.length === 0 && <div className="px-3 py-2 text-[13px] text-text-3">No matching leads</div>}
          {filtered.map((l) => (
            <button
              key={l.id}
              type="button"
              className="block w-full truncate px-3 py-2 text-left text-[13px] text-text hover:bg-surface-3"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(l);
                setOpen(false);
              }}
            >
              {leadLabel(l)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
