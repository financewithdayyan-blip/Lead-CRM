-- ── daily_summaries ──────────────────────────────────────────────────────────
-- A short recap a caller writes once they hit their daily call goal in a
-- session. Visible to the caller and to whoever oversees them.
create table public.daily_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  summary_date date not null default current_date,
  summary text not null,
  created_at timestamptz not null default now(),
  unique (user_id, summary_date)
);
create index daily_summaries_user_id_idx on public.daily_summaries (user_id);

alter table public.daily_summaries enable row level security;

create policy "daily_summaries_select_own_or_team" on public.daily_summaries
  for select using (user_id = auth.uid() or public.is_team_overseer(user_id));

create policy "daily_summaries_insert_own" on public.daily_summaries
  for insert with check (user_id = auth.uid());

create policy "daily_summaries_update_own" on public.daily_summaries
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
