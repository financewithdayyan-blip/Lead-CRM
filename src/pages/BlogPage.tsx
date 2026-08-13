import { useState } from 'react';
import { Newspaper, Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { BlogPostForm } from '@/components/blog/BlogPostForm';
import { useBlogPosts, useDeleteBlogPost, type BlogPost } from '@/hooks/useBlogPosts';

function StatusBadge({ status }: { status: BlogPost['status'] }) {
  return status === 'published' ? (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Published</span>
  ) : (
    <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-text-3">Draft</span>
  );
}

export function BlogPage() {
  const { data: posts = [], isLoading } = useBlogPosts();
  const deletePost = useDeleteBlogPost();
  const [formTarget, setFormTarget] = useState<'new' | BlogPost | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BlogPost | null>(null);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Newspaper size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-text">Blog</h1>
            <p className="text-sm text-text-3">Write and publish SEO-optimized posts to the public site</p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setFormTarget('new')}>
          <Plus size={14} /> New Post
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-text-3">Loading…</p>
      ) : posts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-2 py-16 text-center text-sm text-text-3">
          No posts yet — write your first one to start bringing in organic traffic.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-surface-3 text-[11px] uppercase tracking-wide text-text-3">
              <tr>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Tags</th>
                <th className="px-4 py-2.5 font-medium">Updated</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {posts.map((post) => (
                <tr key={post.id} className="hover:bg-surface-3/50">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-text">{post.title}</div>
                    <div className="text-[11px] text-text-3">/blog/{post.slug}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={post.status} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {post.tags.map((t) => (
                        <span key={t} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-medium text-primary">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-text-3">{new Date(post.updatedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button className="btn !p-1.5" title="Edit" onClick={() => setFormTarget(post)}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn !p-1.5 text-danger" title="Delete" onClick={() => setDeleteTarget(post)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formTarget && (
        <BlogPostForm post={formTarget === 'new' ? null : formTarget} onClose={() => setFormTarget(null)} />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this post?"
        message={
          deleteTarget?.status === 'published'
            ? 'This permanently deletes the post and takes it off the live site once the site rebuilds.'
            : 'This permanently deletes the draft.'
        }
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (deleteTarget) deletePost.mutate({ id: deleteTarget.id, coverImagePath: deleteTarget.coverImagePath });
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
