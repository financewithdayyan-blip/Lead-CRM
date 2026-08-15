-- Views + likes for the public static blog. The blog pages are pre-rendered
-- static HTML with no build-time knowledge of runtime engagement, so counts
-- are read/written live from the client via these security-definer RPCs —
-- the same public-entry-point pattern as get_public_loi/get_signing_party
-- (RLS stays restrictive on the underlying tables; anon/authenticated only
-- ever get EXECUTE on the functions below, never direct table access).
create table if not exists public.blog_post_stats (
  post_id uuid primary key references public.blog_posts(id) on delete cascade,
  view_count bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.blog_post_stats enable row level security;
create policy "blog_post_stats_admin_read" on public.blog_post_stats
  for select using (public.current_role() = 'admin');

-- visitor_id is a random id the client generates and stores in localStorage
-- — not real identity, just enough to stop the same browser from stacking
-- multiple likes on one post. Clearing storage resets it; that's an
-- accepted, low-stakes tradeoff for a marketing blog "like" button, not a
-- security boundary.
create table if not exists public.blog_post_likes (
  post_id uuid not null references public.blog_posts(id) on delete cascade,
  visitor_id text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, visitor_id)
);
alter table public.blog_post_likes enable row level security;
create policy "blog_post_likes_admin_read" on public.blog_post_likes
  for select using (public.current_role() = 'admin');

create or replace function public.get_blog_engagement(p_slug text, p_visitor_id text default null)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'views', coalesce((
      select s.view_count from public.blog_post_stats s
      join public.blog_posts b on b.id = s.post_id
      where b.slug = p_slug
    ), 0),
    'likes', (
      select count(*) from public.blog_post_likes l
      join public.blog_posts b on b.id = l.post_id
      where b.slug = p_slug
    ),
    'liked', case when p_visitor_id is null or length(trim(p_visitor_id)) = 0 then false else exists(
      select 1 from public.blog_post_likes l
      join public.blog_posts b on b.id = l.post_id
      where b.slug = p_slug and l.visitor_id = p_visitor_id
    ) end
  );
$$;
revoke all on function public.get_blog_engagement(text, text) from public;
grant execute on function public.get_blog_engagement(text, text) to anon, authenticated;

create or replace function public.record_blog_view(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id uuid;
begin
  select id into v_post_id from public.blog_posts where slug = p_slug and status = 'published';
  if v_post_id is null then
    return;
  end if;
  insert into public.blog_post_stats (post_id, view_count)
  values (v_post_id, 1)
  on conflict (post_id) do update set view_count = public.blog_post_stats.view_count + 1, updated_at = now();
end;
$$;
revoke all on function public.record_blog_view(text) from public;
grant execute on function public.record_blog_view(text) to anon, authenticated;

create or replace function public.toggle_blog_like(p_slug text, p_visitor_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id uuid;
  v_liked boolean;
begin
  if p_visitor_id is null or length(trim(p_visitor_id)) not between 1 and 100 then
    raise exception 'invalid visitor id';
  end if;
  select id into v_post_id from public.blog_posts where slug = p_slug and status = 'published';
  if v_post_id is null then
    raise exception 'post not found';
  end if;

  if exists (select 1 from public.blog_post_likes where post_id = v_post_id and visitor_id = p_visitor_id) then
    delete from public.blog_post_likes where post_id = v_post_id and visitor_id = p_visitor_id;
    v_liked := false;
  else
    insert into public.blog_post_likes (post_id, visitor_id) values (v_post_id, p_visitor_id);
    v_liked := true;
  end if;

  return json_build_object(
    'liked', v_liked,
    'likes', (select count(*) from public.blog_post_likes where post_id = v_post_id)
  );
end;
$$;
revoke all on function public.toggle_blog_like(text, text) from public;
grant execute on function public.toggle_blog_like(text, text) to anon, authenticated;
