-- ============================================================================
-- SMS outreach, phase 3: per-tag AI qualification frameworks.
-- ============================================================================

-- One row per (admin, tag), plus one row per admin with tag_id null for the
-- Default framework used by any lead whose tags have no saved framework.
create table if not exists public.ai_reply_config (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tag_id uuid references public.tags(id) on delete cascade,
  framework text not null default '',
  updated_at timestamptz not null default now(),
  unique (user_id, tag_id)
);
create index if not exists ai_reply_config_user_id_idx on public.ai_reply_config (user_id);

alter table public.ai_reply_config enable row level security;

create policy "ai_reply_config_all" on public.ai_reply_config
  for all using (public.current_role() = 'admin' and user_id = auth.uid())
  with check (public.current_role() = 'admin' and user_id = auth.uid());
