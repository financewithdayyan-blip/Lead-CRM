-- ============================================================================
-- Lead Caller CRM — normalized schema (v2)
-- Replaces the legacy JSONB-blob tables (leads, call_log, misc_data) with real
-- per-row tables. The legacy "leads" and "call_log" tables collide on name
-- with the new ones below, so they're renamed to legacy_leads/legacy_call_log
-- first; misc_data has no v2 equivalent and is left as-is. Run
-- scripts/migrate-legacy-data.ts afterwards to backfill from the renamed
-- legacy tables, then drop them once verified.
-- ============================================================================

create extension if not exists "pgcrypto";

-- Detect the legacy blob-shaped tables by their "data" column (only the old
-- schema has it) and move them aside so the v2 tables below can claim the
-- names. Safe to re-run: once renamed, this no longer matches.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads' and column_name = 'data'
  ) then
    alter table public.leads rename to legacy_leads;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'call_log' and column_name = 'data'
  ) then
    alter table public.call_log rename to legacy_call_log;
  end if;
end $$;

-- ── profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  caller_name text,
  user_code text unique not null,
  role text not null default 'rep' check (role in ('admin', 'manager', 'rep')),
  daily_goal int not null default 150,
  monthly_goal int not null default 3000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── team_members: who oversees whom ────────────────────────────────────────
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique (owner_id, member_id),
  check (owner_id <> member_id)
);

-- ── tags ────────────────────────────────────────────────────────────────────
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  color_bg text not null,
  color_text text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ── leads ───────────────────────────────────────────────────────────────────
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lead_num int,
  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  phone2 text,
  email text,
  address text,
  state text,
  beds numeric,
  baths numeric,
  sqft numeric,
  lot_size text,
  prop_type text,
  extra text,
  batch text,
  status text not null default 'new',
  rating int not null default 0,
  property_rating int,
  note text,
  motivation text,
  year_built int,
  condition text,
  arv numeric,
  as_is numeric,
  est_repairs numeric,
  min_offer numeric,
  max_offer numeric,
  asking_price numeric,
  final_price numeric,
  repairs jsonb not null default '{}'::jsonb,
  call_answers jsonb not null default '{}'::jsonb,
  kcf_data jsonb not null default '{"checks":{},"fields":{}}'::jsonb,
  strategy_notes text,
  followup_date date,
  next_call_date date,
  voicemail_count int not null default 0,
  called_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_user_id_idx on public.leads (user_id);
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_phone_idx on public.leads (phone);

-- ── lead_tags (join table) ──────────────────────────────────────────────────
create table if not exists public.lead_tags (
  lead_id uuid not null references public.leads(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (lead_id, tag_id)
);

-- ── lead_comps ──────────────────────────────────────────────────────────────
create table if not exists public.lead_comps (
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
create index if not exists lead_comps_lead_id_idx on public.lead_comps (lead_id);

-- ── lead_photos (Supabase Storage paths, replaces inline base64) ───────────
create table if not exists public.lead_photos (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index if not exists lead_photos_lead_id_idx on public.lead_photos (lead_id);

-- ── call_log ────────────────────────────────────────────────────────────────
create table if not exists public.call_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  lead_num int,
  name text,
  phone text,
  address text,
  status text,
  rating int,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists call_log_user_id_idx on public.call_log (user_id);
create index if not exists call_log_lead_id_idx on public.call_log (lead_id);
create index if not exists call_log_created_at_idx on public.call_log (created_at);

create table if not exists public.call_log_tags (
  call_log_id uuid not null references public.call_log(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (call_log_id, tag_id)
);

-- ── tasks (follow-up reminders) ─────────────────────────────────────────────
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  title text not null,
  due_date date,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists tasks_user_id_idx on public.tasks (user_id);
create index if not exists tasks_due_date_idx on public.tasks (due_date);

-- ── session_log (replaces lc_session_count_<uid> / lc_session_days_<uid>) ──
create table if not exists public.session_log (
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_date date not null,
  duration_seconds int not null default 0,
  calls_made int not null default 0,
  primary key (user_id, session_date)
);

-- ── daily_stats (replaces lc_dailystats_<uid> snapshot) ─────────────────────
create table if not exists public.daily_stats (
  user_id uuid not null references public.profiles(id) on delete cascade,
  stat_date date not null,
  calls int not null default 0,
  conversations int not null default 0,
  voicemail int not null default 0,
  dead int not null default 0,
  primary key (user_id, stat_date)
);

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

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_leads_updated_at on public.leads;
create trigger set_leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();
