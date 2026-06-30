-- Replace the old tab-open heartbeat tracking with actual calling session
-- tracking: rows are only created when a caller enters the dialer (/session),
-- not whenever they have any CRM tab open.
drop table if exists public.attendance_sessions;

create table public.calling_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,           -- NULL while the session is still open
  calls_logged int not null default 0,
  created_at timestamptz not null default now()
);
create index calling_sessions_user_id_idx on public.calling_sessions (user_id);
create index calling_sessions_started_at_idx on public.calling_sessions (started_at);

alter table public.calling_sessions enable row level security;

create policy "calling_sessions_select_own_or_team" on public.calling_sessions
  for select using (user_id = auth.uid() or public.is_team_overseer(user_id));

create policy "calling_sessions_insert_own" on public.calling_sessions
  for insert with check (user_id = auth.uid());

create policy "calling_sessions_update_own" on public.calling_sessions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
