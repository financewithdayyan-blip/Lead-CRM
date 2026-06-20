-- ============================================================================
-- Auth bootstrap + Row Level Security
--
-- Design goal: eliminate the legacy "service role key pasted into Settings
-- and stored in browser localStorage" pattern entirely. Team-based access
-- (admin/manager viewing a rep's leads) is granted declaratively through RLS
-- using the team_members table + role check below, evaluated with the user's
-- normal anon-key + JWT session. No privileged key ever needs to reach the
-- browser for this app's actual access patterns.
-- ============================================================================

-- ── auto-create a profile row whenever a new auth user signs up ────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  v_code := upper(substr(replace(new.id::text, '-', ''), 1, 6));
  insert into public.profiles (id, email, caller_name, user_code, role)
  values (
    new.id,
    new.email,
    split_part(coalesce(new.email, 'user'), '@', 1),
    v_code,
    case when new.email = 'dayyan@bluebirdacquisition.com' then 'admin' else 'rep' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── security-definer helper: does the current user oversee target_user_id? ──
-- Avoids RLS recursion (a policy on team_members can't safely query team_members).
create or replace function public.is_team_overseer(target_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.profiles p on p.id = auth.uid()
    where tm.member_id = target_user_id
      and tm.owner_id = auth.uid()
      and p.role in ('admin', 'manager')
  );
$$;

create or replace function public.current_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ── profiles ─────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

create policy "profiles_select_own_or_team" on public.profiles
  for select using (id = auth.uid() or public.is_team_overseer(id));

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Only admins can change someone else's role.
create policy "profiles_admin_update_role" on public.profiles
  for update using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- ── team_members ─────────────────────────────────────────────────────────────
alter table public.team_members enable row level security;

create policy "team_members_select" on public.team_members
  for select using (owner_id = auth.uid() or member_id = auth.uid());

create policy "team_members_insert" on public.team_members
  for insert with check (
    owner_id = auth.uid() and public.current_role() in ('admin', 'manager')
  );

create policy "team_members_delete" on public.team_members
  for delete using (owner_id = auth.uid());

-- ── tags ─────────────────────────────────────────────────────────────────────
alter table public.tags enable row level security;

create policy "tags_select" on public.tags
  for select using (user_id = auth.uid() or public.is_team_overseer(user_id));

create policy "tags_insert" on public.tags
  for insert with check (user_id = auth.uid());

create policy "tags_update" on public.tags
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "tags_delete" on public.tags
  for delete using (user_id = auth.uid());

-- ── leads ────────────────────────────────────────────────────────────────────
alter table public.leads enable row level security;

create policy "leads_select" on public.leads
  for select using (user_id = auth.uid() or public.is_team_overseer(user_id));

create policy "leads_insert" on public.leads
  for insert with check (user_id = auth.uid());

-- Admins may edit a team member's leads directly (coaching/cleanup); managers
-- are read-only on leads they don't own.
create policy "leads_update" on public.leads
  for update using (
    user_id = auth.uid()
    or (public.is_team_overseer(user_id) and public.current_role() = 'admin')
  )
  with check (
    user_id = auth.uid()
    or (public.is_team_overseer(user_id) and public.current_role() = 'admin')
  );

create policy "leads_delete" on public.leads
  for delete using (user_id = auth.uid());

-- ── lead_tags / lead_comps / lead_photos: scoped through their parent lead ──
alter table public.lead_tags enable row level security;
create policy "lead_tags_select" on public.lead_tags
  for select using (
    exists (select 1 from public.leads l where l.id = lead_id and (l.user_id = auth.uid() or public.is_team_overseer(l.user_id)))
  );
create policy "lead_tags_write" on public.lead_tags
  for all using (
    exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())
  );

alter table public.lead_comps enable row level security;
create policy "lead_comps_select" on public.lead_comps
  for select using (
    exists (select 1 from public.leads l where l.id = lead_id and (l.user_id = auth.uid() or public.is_team_overseer(l.user_id)))
  );
create policy "lead_comps_write" on public.lead_comps
  for all using (
    exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())
  );

alter table public.lead_photos enable row level security;
create policy "lead_photos_select" on public.lead_photos
  for select using (
    exists (select 1 from public.leads l where l.id = lead_id and (l.user_id = auth.uid() or public.is_team_overseer(l.user_id)))
  );
create policy "lead_photos_write" on public.lead_photos
  for all using (
    exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())
  );

-- ── call_log ─────────────────────────────────────────────────────────────────
alter table public.call_log enable row level security;

create policy "call_log_select" on public.call_log
  for select using (user_id = auth.uid() or public.is_team_overseer(user_id));

create policy "call_log_insert" on public.call_log
  for insert with check (user_id = auth.uid());

create policy "call_log_delete" on public.call_log
  for delete using (user_id = auth.uid());

alter table public.call_log_tags enable row level security;
create policy "call_log_tags_select" on public.call_log_tags
  for select using (
    exists (select 1 from public.call_log c where c.id = call_log_id and (c.user_id = auth.uid() or public.is_team_overseer(c.user_id)))
  );
create policy "call_log_tags_write" on public.call_log_tags
  for all using (
    exists (select 1 from public.call_log c where c.id = call_log_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.call_log c where c.id = call_log_id and c.user_id = auth.uid())
  );

-- ── tasks ────────────────────────────────────────────────────────────────────
alter table public.tasks enable row level security;

create policy "tasks_select" on public.tasks
  for select using (user_id = auth.uid() or public.is_team_overseer(user_id));

create policy "tasks_write" on public.tasks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── session_log / daily_stats ────────────────────────────────────────────────
alter table public.session_log enable row level security;
create policy "session_log_select" on public.session_log
  for select using (user_id = auth.uid() or public.is_team_overseer(user_id));
create policy "session_log_write" on public.session_log
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.daily_stats enable row level security;
create policy "daily_stats_select" on public.daily_stats
  for select using (user_id = auth.uid() or public.is_team_overseer(user_id));
create policy "daily_stats_write" on public.daily_stats
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
