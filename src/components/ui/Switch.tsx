/** A standalone on/off toggle — track and knob both sized off the same
 * `inline-flex items-center` + `transform` recipe (no absolute positioning,
 * no reliance on implicit default alignment), so the knob is guaranteed to
 * stay centered and fully inside the track at any size. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-60 ${
        checked ? 'bg-primary' : 'bg-border-2'
      }`}
    >
      <span
        className={`h-5 w-5 shrink-0 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );
}
