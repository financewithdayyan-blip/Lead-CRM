import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export type BlogPostStatus = 'draft' | 'published';

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  bodyMarkdown: string;
  coverImagePath: string | null;
  tags: string[];
  status: BlogPostStatus;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function fromRow(r: any): BlogPost {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    bodyMarkdown: r.body_markdown ?? '',
    coverImagePath: r.cover_image_path,
    tags: r.tags ?? [],
    status: r.status,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Kebab-case, matching the DB's blog_posts_slug_format check constraint. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function blogCoverPublicUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from('blog-images').getPublicUrl(path).data.publicUrl;
}

export function useBlogPosts() {
  return useQuery({
    queryKey: ['blog_posts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('blog_posts').select('*').order('updated_at', { ascending: false });
      if (error) throw error;
      return data.map(fromRow);
    },
  });
}

export interface BlogPostInput {
  slug: string;
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  coverImagePath: string | null;
  tags: string[];
  status: BlogPostStatus;
  seoTitle: string;
  seoDescription: string;
}

export function useCreateBlogPost() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BlogPostInput) => {
      const { data, error } = await supabase
        .from('blog_posts')
        .insert({
          slug: input.slug,
          title: input.title,
          excerpt: input.excerpt || null,
          body_markdown: input.bodyMarkdown,
          cover_image_path: input.coverImagePath,
          tags: input.tags,
          status: input.status,
          seo_title: input.seoTitle || null,
          seo_description: input.seoDescription || null,
          published_at: input.status === 'published' ? new Date().toISOString() : null,
          created_by: session!.user.id,
        })
        .select('*')
        .single();
      if (error) throw error;
      return fromRow(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blog_posts'] }),
  });
}

export function useUpdateBlogPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, wasPublished, ...input }: BlogPostInput & { id: string; wasPublished: boolean }) => {
      const { error } = await supabase
        .from('blog_posts')
        .update({
          slug: input.slug,
          title: input.title,
          excerpt: input.excerpt || null,
          body_markdown: input.bodyMarkdown,
          cover_image_path: input.coverImagePath,
          tags: input.tags,
          status: input.status,
          seo_title: input.seoTitle || null,
          seo_description: input.seoDescription || null,
          // Only set on the transition into published, so re-saving an
          // already-published post doesn't reset its original publish date.
          published_at: input.status === 'published' && !wasPublished ? new Date().toISOString() : undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blog_posts'] }),
  });
}

export function useDeleteBlogPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, coverImagePath }: { id: string; coverImagePath: string | null }) => {
      if (coverImagePath) await supabase.storage.from('blog-images').remove([coverImagePath]);
      const { error } = await supabase.from('blog_posts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blog_posts'] }),
  });
}

export function useUploadCoverImage() {
  return useMutation({
    mutationFn: async (file: File) => {
      const path = `covers/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from('blog-images').upload(path, file);
      if (error) throw error;
      return path;
    },
  });
}
