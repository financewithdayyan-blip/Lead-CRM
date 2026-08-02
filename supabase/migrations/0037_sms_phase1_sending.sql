-- ============================================================================
-- SMS outreach, phase 1: sending infrastructure.
--
-- Adds two pipeline stages, the per-lead flags the outreach engine needs, a
-- normalised phone for inbound matching, and the append-only send log.
-- ============================================================================

-- ── Pipeline: Contacted and Replied ─────────────────────────────────────────
-- A cold lead moves to 'contacted' when a bulk text goes out, and to 'replied'
-- when they answer, so the board shows outreach state without a caller having
-- touched it.
alter table public.leads drop constraint if exists leads_stage_check;
alter table public.leads add constraint leads_stage_check check (stage in (
  'new', 'voicemail', 'contacted', 'replied', 'initial_contact',
  'followup', 'negotiation', 'contract', 'dead_declined', 'onhold'
));

-- ── Per-lead outreach flags ─────────────────────────────────────────────────
-- Both live on leads rather than a side table because every bulk send filters
-- on them and every inbound message reads them.

-- Set by a STOP/DNC request or a decline. Excludes the lead from all future
-- bulk sends, permanently.
alter table public.leads add column if not exists opted_out boolean not null default false;

-- Set when a lead is fully qualified, or when a human replies by hand. Stops
-- the AI so the two never talk over each other.
alter table public.leads add column if not exists ai_reply_paused boolean not null default false;

-- ── Normalised phone for inbound matching ───────────────────────────────────
-- Leads store phones as free text ("+1267-312-0632", "(267) 312 0632") while
-- Zoom sends bare digits with no leading +. Matching on the raw column would
-- miss almost everything, so keep the last ten digits alongside it. Generated
-- rather than triggered so it can never drift from the source column.
alter table public.leads
  add column if not exists phone_norm text
  generated always as (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)) stored;

alter table public.leads
  add column if not exists phone2_norm text
  generated always as (right(regexp_replace(coalesce(phone2, ''), '[^0-9]', '', 'g'), 10)) stored;

create index if not exists leads_phone_norm_idx  on public.leads (phone_norm);
create index if not exists leads_phone2_norm_idx on public.leads (phone2_norm);

-- ── send_log ────────────────────────────────────────────────────────────────
-- Append-only, and deliberately survives the lead it refers to.
--
-- Leads get exported and deleted regularly to keep the database small, so
-- "how many have I sent" and the per-number rolling limits must not be derived
-- from the leads table. lead_id is ON DELETE SET NULL rather than CASCADE for
-- exactly this reason: deleting a lead must never erase the fact that a number
-- was already contacted.
create table if not exists public.send_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  phone text not null,
  -- Kept independently of lead_id so an opt-out check still works after the
  -- lead row is gone.
  phone_norm text not null,
  sent_from text not null,
  body text not null,
  sent_at timestamptz not null default now()
);

-- Rolling-window counts are always "sent_from + time", never a calendar day.
create index if not exists send_log_from_sent_at_idx on public.send_log (sent_from, sent_at desc);
create index if not exists send_log_phone_norm_idx   on public.send_log (phone_norm);
create index if not exists send_log_user_sent_at_idx on public.send_log (user_id, sent_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Admin-only feature, so the policy is narrower than the usual owner-or-
-- overseer pattern: a caller has no reason to read the outreach log at all.
alter table public.send_log enable row level security;

create policy "send_log_select" on public.send_log
  for select using (public.current_role() = 'admin');

create policy "send_log_insert" on public.send_log
  for insert with check (public.current_role() = 'admin' and user_id = auth.uid());

-- No update or delete policy by design — the log is append-only.

-- ── Rolling-window send count ───────────────────────────────────────────────
-- One place that defines "how many has this number sent recently", so the UI
-- and the send function can never disagree. A rolling 24 hours, not a
-- midnight reset.
create or replace function public.sends_in_window(p_sent_from text, p_hours int default 24)
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select count(*)
  from public.send_log
  where sent_from = p_sent_from
    and sent_at > now() - make_interval(hours => p_hours);
$$;

revoke all on function public.sends_in_window(text, int) from public;
grant execute on function public.sends_in_window(text, int) to authenticated;
