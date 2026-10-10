import { useEffect, useRef, useState } from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface EditableFieldProps {
  label: string;
  /** Raw value the input edits — always a plain string, even for a number
   *  or date field (native input types still want a string). */
  value: string;
  /** What's shown in read mode, if different from the raw value (e.g. a
   *  formatted currency amount, a "Paid off" override, a Cold/Warm/Hot
   *  label for a 0/1/2 rating). Falls back to value when omitted. */
  display?: string;
  placeholder?: string;
  onSave: (value: string) => void;
  type?: 'text' | 'number' | 'date' | 'select' | 'textarea';
  options?: SelectOption[];
  /** Strips/normalizes a keystroke before it lands in the draft — e.g.
   *  currency fields stripping non-numeric characters as you type. */
  filter?: (raw: string) => string;
  /** 'stacked' (default) — label above value, for the grid-of-cells cards
   *  (Lead Information, Property Details). 'inline' — label left, value
   *  right, for a sidebar list of rows (Contact). Same click-to-edit
   *  behavior either way, just laid out to match where it's used. */
  variant?: 'stacked' | 'inline';
  /** Blocks starting a new edit while true — pass the card's own
   *  mutation.isPending. Each field saves independently now instead of one
   *  bulk submit, so without this, saving field A and clicking into field B
   *  before A's save lands would compute B's save off of a lead snapshot
   *  that doesn't have A's change yet, and A's edit would be silently lost
   *  once B's save completes (the same class of lost-update race the Title
   *  & Closing checklist hit — see RepairFlags checkboxes in PropertyTab for
   *  the non-field version of this same guard). */
  disabled?: boolean;
}

/** Click the value, it becomes an input; blur or Enter saves, Escape
 *  cancels — one field, one save, no corner "Edit" button putting the
 *  whole card into a bulk form just to change one line. Committing is
 *  guarded against firing twice (Enter followed by the blur it triggers)
 *  with a ref flag reset each time editing starts. */
export function EditableField({
  label,
  value,
  display,
  placeholder = '—',
  onSave,
  type = 'text',
  options,
  filter,
  variant = 'stacked',
  disabled,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const committedRef = useRef(false);
  // One ref shared across whichever of input/select/textarea actually
  // renders below — only ever needs .focus(), so the element-specific
  // typing isn't worth the three-way union/cast dance.
  const inputRef = useRef<any>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEdit() {
    if (disabled) return;
    committedRef.current = false;
    setDraft(value);
    setEditing(true);
  }

  function commit(next = draft) {
    if (committedRef.current) return;
    committedRef.current = true;
    setEditing(false);
    if (next !== value) onSave(next);
  }

  function cancel() {
    committedRef.current = true;
    setEditing(false);
  }

  const inline = variant === 'inline';

  if (!editing) {
    const valueClass = `border-b border-dashed border-transparent font-medium text-text group-hover/field:border-border-2 group-hover/field:text-primary ${
      inline ? 'text-[13px]' : 'mt-0.5 truncate text-[13.5px]'
    }`;
    return (
      <button
        type="button"
        onClick={startEdit}
        disabled={disabled}
        className={`disabled:cursor-not-allowed disabled:opacity-60 ${
          inline
            ? 'group/field flex w-full items-center justify-between gap-3 py-1.5 text-left'
            : 'group/field block w-full text-left'
        }`}
      >
        <div className={inline ? 'text-[11px] uppercase tracking-wide text-text-3' : 'text-[10.5px] font-semibold uppercase tracking-wide text-text-3'}>
          {label}
        </div>
        <div className={valueClass}>{(display ?? value) || placeholder}</div>
      </button>
    );
  }

  const commonProps = {
    ref: inputRef,
    className: inline ? 'input !w-auto !py-1 text-[12px]' : 'input',
    autoFocus: true,
    onBlur: () => commit(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && type !== 'textarea') commit();
      if (e.key === 'Escape') cancel();
    },
  };

  const control =
    type === 'select' ? (
      <select
        {...commonProps}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          commit(e.target.value);
        }}
      >
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    ) : type === 'textarea' ? (
      <textarea {...commonProps} rows={2} value={draft} onChange={(e) => setDraft(filter ? filter(e.target.value) : e.target.value)} />
    ) : (
      <input {...commonProps} type={type} value={draft} onChange={(e) => setDraft(filter ? filter(e.target.value) : e.target.value)} />
    );

  if (inline) {
    return (
      <div className="flex items-center justify-between gap-3 py-1.5">
        <div className="text-[11px] uppercase tracking-wide text-text-3">{label}</div>
        {control}
      </div>
    );
  }

  return (
    <div>
      <div className="label">{label}</div>
      {control}
    </div>
  );
}
