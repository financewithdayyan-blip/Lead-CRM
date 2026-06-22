-- ============================================================================
-- Lead CRM — fresh schema for a new Supabase project.
--
-- Pipeline (single source of truth, 1:1 with the Kanban board):
--   new -> voicemail -> initial_contact -> followup -> negotiation
--       -> contract -> dead_declined / onhold
--
-- Team-based access (admin/manager viewing a rep's leads) is granted
-- declaratively through RLS using team_members + a security-definer helper,
-- evaluated against the caller's normal anon-key + JWT session. No
-- privileged key ever needs to reach the browser.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── profiles ─────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  user_code text unique not null,
  role text not null default 'rep' check (role in ('admin', 'manager', 'rep')),
  daily_goal int not null default 20,
  monthly_goal int not null default 400,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── team_members: who oversees whom ────────────────────────────────────────
create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique (owner_id, member_id),
  check (owner_id <> member_id)
);

-- ── tags ────────────────────────────────────────────────────────────────────
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  color_bg text not null,
  color_text text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ── leads ───────────────────────────────────────────────────────────────────
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lead_num int,
  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  phone2 text,
  email text,
  address text,
  city text,
  state text,
  zip text,
  source text,
  stage text not null default 'new' check (stage in
    ('new', 'voicemail', 'initial_contact', 'followup', 'negotiation', 'contract', 'dead_declined', 'onhold')),
  rating int not null default 0,
  prop_type text,
  beds numeric,
  baths numeric,
  sqft numeric,
  lot_size text,
  year_built int,
  condition text,
  motivation text,
  arv numeric,
  as_is numeric,
  est_repairs numeric,
  min_offer numeric,
  max_offer numeric,
  asking_price numeric,
  final_price numeric,
  repairs jsonb not null default '{}'::jsonb,
  notes text,
  next_follow_up date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_user_id_idx on public.leads (user_id);
create index leads_stage_idx on public.leads (stage);
create index leads_phone_idx on public.leads (phone);
create index leads_next_follow_up_idx on public.leads (next_follow_up);

-- Auto-number leads per owner (Lead #1, #2, ... scoped to each rep).
create or replace function public.set_lead_num()
returns trigger
language plpgsql
as $$
begin
  if new.lead_num is null then
    select coalesce(max(lead_num), 0) + 1 into new.lead_num
    from public.leads where user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger set_leads_lead_num before insert on public.leads
  for each row execute function public.set_lead_num();

-- ── lead_tags (join table) ──────────────────────────────────────────────────
create table public.lead_tags (
  lead_id uuid not null references public.leads(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (lead_id, tag_id)
);

-- ── lead_comps ──────────────────────────────────────────────────────────────
create table public.lead_comps (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  address text,
  price numeric,
  sqft numeric,
  beds numeric,
  baths numeric,
  distance text,
  notes text,
  created_at timestamptz not null default now()
);
create index lead_comps_lead_id_idx on public.lead_comps (lead_id);

-- ── lead_files (Supabase Storage paths — photos, docs, contracts) ─────────
create table public.lead_files (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_type text,
  created_at timestamptz not null default now()
);
create index lead_files_lead_id_idx on public.lead_files (lead_id);

-- ── lead_activities (unified timeline: notes, calls, emails, stage changes) ─
create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('note', 'call', 'email', 'meeting', 'sms', 'stage_change')),
  body text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index lead_activities_lead_id_idx on public.lead_activities (lead_id);
create index lead_activities_user_id_idx on public.lead_activities (user_id);
create index lead_activities_created_at_idx on public.lead_activities (created_at);

-- Drop a stage_change activity automatically whenever a lead's stage changes,
-- so the timeline never drifts out of sync with the actual record.
create or replace function public.log_lead_stage_change()
returns trigger
language plpgsql
as $$
begin
  if new.stage is distinct from old.stage then
    insert into public.lead_activities (lead_id, user_id, type, meta)
    values (new.id, new.user_id, 'stage_change', jsonb_build_object('from', old.stage, 'to', new.stage));
  end if;
  return new;
end;
$$;

create trigger leads_log_stage_change after update on public.leads
  for each row execute function public.log_lead_stage_change();

-- ── tasks (follow-up reminders) ─────────────────────────────────────────────
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  title text not null,
  due_date date,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);
create index tasks_user_id_idx on public.tasks (user_id);
create index tasks_due_date_idx on public.tasks (due_date);

-- ── updated_at triggers ──────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger set_leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Auth bootstrap
-- ============================================================================

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
  insert into public.profiles (id, email, full_name, user_code, role)
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

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- security-definer helper: does the current user oversee target_user_id?
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

-- ── lead_tags / lead_comps / lead_files / lead_activities: via parent lead ──
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

alter table public.lead_files enable row level security;
create policy "lead_files_select" on public.lead_files
  for select using (
    exists (select 1 from public.leads l where l.id = lead_id and (l.user_id = auth.uid() or public.is_team_overseer(l.user_id)))
  );
create policy "lead_files_write" on public.lead_files
  for all using (
    exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())
  );

alter table public.lead_activities enable row level security;
create policy "lead_activities_select" on public.lead_activities
  for select using (
    exists (select 1 from public.leads l where l.id = lead_id and (l.user_id = auth.uid() or public.is_team_overseer(l.user_id)))
  );
create policy "lead_activities_insert" on public.lead_activities
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())
  );
create policy "lead_activities_delete" on public.lead_activities
  for delete using (user_id = auth.uid());

-- ── tasks ────────────────────────────────────────────────────────────────────
alter table public.tasks enable row level security;

create policy "tasks_select" on public.tasks
  for select using (user_id = auth.uid() or public.is_team_overseer(user_id));

create policy "tasks_write" on public.tasks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- Profile directory (for "add team member by code" lookup)
-- ============================================================================

-- Minimal, non-sensitive view so any signed-in user can be found by an
-- admin/manager via their user_code before a team_members relationship
-- exists (chicken-and-egg: is_team_overseer() can't help you find someone
-- you don't yet oversee). Deliberately omits role/goals/etc.
create view public.profile_directory
  with (security_invoker = false) as
  select id, user_code, full_name, email
  from public.profiles;

grant select on public.profile_directory to authenticated;

-- ============================================================================
-- Storage bucket for lead files (photos, docs, contracts)
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('lead-files', 'lead-files', false)
on conflict (id) do nothing;

-- Object paths are namespaced "<user_id>/<lead_id>/<filename>" by convention
-- (enforced client-side on upload); policies check the leading folder against
-- auth.uid() and team oversight.
create policy "lead_files_storage_select" on storage.objects
  for select using (
    bucket_id = 'lead-files'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_team_overseer(((storage.foldername(name))[1])::uuid)
    )
  );

create policy "lead_files_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'lead-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "lead_files_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'lead-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
