import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { RichTextEditor } from '@/components/blog/RichTextEditor';
import { TagInput } from '@/components/blog/TagInput';
import { CoverImageUpload } from '@/components/blog/CoverImageUpload';
import { SeoFieldsCard } from '@/components/blog/SeoFieldsCard';
import { slugify, useCreateBlogPost, useUpdateBlogPost, type BlogPost, type BlogPostInput } from '@/hooks/useBlogPosts';

export function BlogPostForm({ post, onClose }: { post: BlogPost | null; onClose: () => void }) {
  const create = useCreateBlogPost();
  const update = useUpdateBlogPost();

  const [title, setTitle] = useState(post?.title ?? '');
  const [slug, setSlug] = useState(post?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(!!post);
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? '');
  const [bodyHtml, setBodyHtml] = useState(post?.bodyHtml ?? '');
  const [coverImagePath, setCoverImagePath] = useState<string | null>(post?.coverImagePath ?? null);
  const [tags, setTags] = useState<string[]>(post?.tags ?? []);
  const [seoTitle, setSeoTitle] = useState(post?.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(post?.seoDescription ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  // Tiptap's "empty" content is still "<p></p>", not "" — strip tags before checking.
  const bodyIsEmpty = !bodyHtml.replace(/<[^>]*>/g, '').trim();
  const canSubmit = title.trim() && slug.trim() && !bodyIsEmpty;

  async function handleSubmit(status: 'draft' | 'published') {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const input: BlogPostInput = {
      slug: slug.trim(),
      title: title.trim(),
      excerpt: excerpt.trim(),
      bodyHtml,
      coverImagePath,
      tags,
      status,
      seoTitle: seoTitle.trim(),
      seoDescription: seoDescription.trim(),
    };
    try {
      if (post) {
        await update.mutateAsync({ id: post.id, wasPublished: post.status === 'published', ...input });
      } else {
        await create.mutateAsync(input);
      }
      onClose();
    } catch (e: any) {
      setError(e?.code === '23505' ? 'That slug is already in use — pick a different one.' : e?.message ?? 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={post ? 'Edit Post' : 'New Post'} width="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="mb-1 block text-[12px] font-medium text-text-2">Title</label>
            <input className="input" value={title} onChange={(e) => handleTitleChange(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Slug</label>
            <input
              className="input font-mono !text-[12px]"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-text-2">Excerpt</label>
          <textarea
            className="input"
            rows={2}
            placeholder="One or two sentences for the blog card and as a fallback meta description."
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Tags</label>
            <TagInput tags={tags} onChange={setTags} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Cover image</label>
            <CoverImageUpload path={coverImagePath} onChange={setCoverImagePath} />
          </div>
        </div>

        <RichTextEditor value={bodyHtml} onChange={setBodyHtml} />

        <SeoFieldsCard
          seoTitle={seoTitle}
          seoDescription={seoDescription}
          onSeoTitleChange={setSeoTitle}
          onSeoDescriptionChange={setSeoDescription}
          titleFallback={title}
          descriptionFallback={excerpt}
        />

        {error && <p className="text-[13px] text-danger">{error}</p>}

        <div className="flex items-center justify-between border-t border-border pt-4">
          <button className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <div className="flex gap-2">
            <button className="btn" onClick={() => handleSubmit('draft')} disabled={!canSubmit || submitting}>
              Save Draft
            </button>
            <button className="btn btn-primary" onClick={() => handleSubmit('published')} disabled={!canSubmit || submitting}>
              {post?.status === 'published' ? 'Save & Keep Published' : 'Publish'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
