import { useMemo } from 'react';
import { marked } from 'marked';

/** Split-pane Markdown editor. The preview calls the exact same
 * `marked.parse()` used by scripts/generate-blog.mjs to render the shipped
 * post body — what an admin sees here is what goes live, not an
 * approximation of it. */
export function MarkdownEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // marked.parse()'s return type is a union with Promise<string> only because
  // of its (unused here) async-extension option — this call is always sync.
  const html = useMemo(() => marked.parse(value || '*Nothing to preview yet.*') as string, [value]);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div>
        <label className="mb-1 block text-[12px] font-medium text-text-2">Body (Markdown)</label>
        <textarea
          className="input h-[420px] resize-y font-mono !text-[13px] leading-relaxed"
          placeholder={'## A heading\n\nWrite the post here using Markdown — **bold**, *italic*, [links](https://example.com), lists, etc.'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <div>
        <label className="mb-1 block text-[12px] font-medium text-text-2">Preview</label>
        {/* Rendered from admin-authored Markdown only — no sanitization pass, see the plan's v1 limitations note. */}
        <div
          className="post-preview h-[420px] overflow-y-auto rounded-md border border-border-2 bg-white p-4"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
