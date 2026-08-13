// Thresholds mirror the ones used by hand when writing this site's own
// title/meta tags earlier — ~60 chars before a title risks truncation in
// search results, ~155 for a description.
function counterColor(len: number, target: number) {
  if (len === 0) return 'text-text-3';
  if (len <= target) return 'text-emerald-600';
  if (len <= target * 1.1) return 'text-amber-600';
  return 'text-danger';
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  target,
  multiline,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  target: number;
  multiline?: boolean;
}) {
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-[12px] font-medium text-text-2">{label}</label>
        <span className={`text-[11px] font-medium tabular-nums ${counterColor(value.length, target)}`}>
          {value.length} / {target}
        </span>
      </div>
      <Tag
        className="input"
        rows={multiline ? 3 : undefined}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function SeoFieldsCard({
  seoTitle,
  seoDescription,
  onSeoTitleChange,
  onSeoDescriptionChange,
  titleFallback,
  descriptionFallback,
}: {
  seoTitle: string;
  seoDescription: string;
  onSeoTitleChange: (v: string) => void;
  onSeoDescriptionChange: (v: string) => void;
  titleFallback: string;
  descriptionFallback: string;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border-2 bg-surface-3 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3">SEO (optional overrides)</p>
      <Field
        label="Title tag"
        placeholder={titleFallback || 'Falls back to the post title'}
        value={seoTitle}
        onChange={onSeoTitleChange}
        target={60}
      />
      <Field
        label="Meta description"
        placeholder={descriptionFallback || 'Falls back to the excerpt'}
        value={seoDescription}
        onChange={onSeoDescriptionChange}
        target={155}
        multiline
      />
    </div>
  );
}
