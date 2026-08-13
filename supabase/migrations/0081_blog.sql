-- ============================================================================
-- Blog — admin-authored marketing posts, generated to static HTML at build
-- time (see scripts/generate-blog.mjs) rather than served live from a public
-- route, so search crawlers and social-share unfurls see real HTML with no
-- client-side render step involved.
--
-- Admin-only end to end, same posture as Blue Docs (0049): no caller other
-- than an admin session or the build script's service-role key ever reads
-- this table, so there's no public RPC here — see that script's own notes
-- for why a security-definer RPC (the get_public_loi pattern) doesn't apply.
-- ============================================================================

create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text,                      -- card summary; SEO description fallback
  body_markdown text not null default '',
  cover_image_path text,             -- path within the blog-images bucket
  tags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'published')),
  seo_title text,                    -- falls back to title if null
  seo_description text,              -- falls back to excerpt if null
  published_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_posts_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create index blog_posts_status_idx on public.blog_posts (status);
create index blog_posts_tags_idx on public.blog_posts using gin (tags);

alter table public.blog_posts enable row level security;

create policy "blog_posts_all" on public.blog_posts
  for all using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

-- ============================================================================
-- Storage — public bucket (unlike private blue-docs) since cover images are
-- marketing assets meant to be served directly, including as og:image.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('blog-images', 'blog-images', true)
on conflict (id) do nothing;

create policy "blog_images_storage_select" on storage.objects
  for select using (bucket_id = 'blog-images');

create policy "blog_images_storage_insert" on storage.objects
  for insert with check (bucket_id = 'blog-images' and public.current_role() = 'admin');

create policy "blog_images_storage_delete" on storage.objects
  for delete using (bucket_id = 'blog-images' and public.current_role() = 'admin');
