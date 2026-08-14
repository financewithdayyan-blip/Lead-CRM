import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered } from 'lucide-react';
import { cn } from '@/lib/utils';

type StyleValue = 'paragraph' | 'h2' | 'h3' | 'h4';

function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()} // keep the editor's selection instead of stealing focus
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded transition-colors',
        active ? 'bg-primary/15 text-primary' : 'text-text-2 hover:bg-surface-3 hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

/** Toolbar-driven rich text editor. Outputs semantic HTML directly (h2-h4,
 * p, strong, em, u, ul/ol/li) — no separate preview needed since formatting
 * is applied live, and no Markdown source to keep in sync with a rendered
 * view. H1 is deliberately not offered here: the post's own title already
 * renders as the page's one <h1> (see scripts/blog-template.mjs), and a
 * second one in the body would reintroduce the exact multi-H1 SEO problem
 * fixed sitewide earlier — H2-H4 give plenty of structure without that risk. */
export function RichTextEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    extensions: [StarterKit, Underline],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: 'ProseMirror-editor' },
      // Content copied from ChatGPT, Google Docs, and similar sources often
      // separates lines with <br> instead of real paragraph tags, which
      // would otherwise land as one giant block — every heading/paragraph
      // toggle is block-level, so applying "Heading" anywhere inside that
      // block converts the whole thing at once. Splitting <br> runs into
      // real paragraphs on paste is what makes "select one line, make it a
      // heading" affect only that line.
      transformPastedHTML: (html) => {
        if (!/<br\s*\/?>/i.test(html)) return html; // already uses real block tags — leave it alone
        return `<p>${html.replace(/(<br\s*\/?>\s*)+/gi, '</p><p>')}</p>`;
      },
    },
  });

  const state = useEditorState({
    editor,
    selector: (ctx) => {
      const e = ctx.editor;
      if (!e) return null;
      const style: StyleValue = e.isActive('heading', { level: 2 })
        ? 'h2'
        : e.isActive('heading', { level: 3 })
          ? 'h3'
          : e.isActive('heading', { level: 4 })
            ? 'h4'
            : 'paragraph';
      return {
        style,
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        bulletList: e.isActive('bulletList'),
        orderedList: e.isActive('orderedList'),
      };
    },
  });

  if (!editor || !state) return null;

  function setStyle(next: StyleValue) {
    const chain = editor!.chain().focus();
    if (next === 'paragraph') chain.setParagraph().run();
    else chain.setHeading({ level: Number(next[1]) as 2 | 3 | 4 }).run();
  }

  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-text-2">Body</label>
      <div className="overflow-hidden rounded-md border border-border-2 bg-white">
        <div className="flex flex-wrap items-center gap-1 border-b border-border-2 bg-surface-3 px-2 py-1.5">
          <select
            className="h-7 rounded border border-border-2 bg-white px-1.5 text-[12px] font-medium text-text"
            value={state.style}
            onChange={(e) => setStyle(e.target.value as StyleValue)}
          >
            <option value="paragraph">Paragraph</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="h4">Heading 4</option>
          </select>
          <div className="mx-1 h-5 w-px bg-border-2" />
          <ToolbarButton active={state.bold} label="Bold" onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold size={14} />
          </ToolbarButton>
          <ToolbarButton active={state.italic} label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic size={14} />
          </ToolbarButton>
          <ToolbarButton active={state.underline} label="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <UnderlineIcon size={14} />
          </ToolbarButton>
          <div className="mx-1 h-5 w-px bg-border-2" />
          <ToolbarButton
            active={state.bulletList}
            label="Bulleted list"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List size={14} />
          </ToolbarButton>
          <ToolbarButton
            active={state.orderedList}
            label="Numbered list"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={14} />
          </ToolbarButton>
        </div>
        <EditorContent editor={editor} className="tiptap-editor max-h-[420px] min-h-[280px] overflow-y-auto px-4 py-3" />
      </div>
    </div>
  );
}
