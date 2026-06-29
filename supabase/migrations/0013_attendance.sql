-- ── attendance_sessions ──────────────────────────────────────────────────────
-- One row per continuous stretch a caller/admin has the CRM open. started_at
-- is set once on sign-in; ended_at is bumped forward by a heartbeat while the
-- tab stays open and finalized precisely on sign-out, so duration is always
-- just `ended_at - started_at` with no null "still open" state to handle.
create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index attendance_sessions_user_id_idx on public.attendance_sessions (user_id);
create index attendance_sessions_started_at_idx on public.attendance_sessions (started_at);

alter table public.attendance_sessions enable row level security;

create policy "attendance_sessions_select_own_or_team" on public.attendance_sessions
  for select using (user_id = auth.uid() or public.is_team_overseer(user_id));

create policy "attendance_sessions_insert_own" on public.attendance_sessions
  for insert with check (user_id = auth.uid());

create policy "attendance_sessions_update_own" on public.attendance_sessions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
