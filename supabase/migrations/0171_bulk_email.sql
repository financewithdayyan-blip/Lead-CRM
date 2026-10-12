-- ============================================================================
-- Bulk Email — same job/item shape as bulk_sms_jobs/bulk_sms_job_items (see
-- 0046 + its amendments), a separate channel: its own sending identity (a
-- dedicated domain/SMTP account, not the one send-packet-email already uses
-- for deal-packet emails — kept apart deliberately so a bulk marketing-style
-- send's spam complaints can never hurt that address's deliverability), its
-- own opt-out, and no 7pm-6am Pakistan send-window restriction (that's an
-- SMS-carrier constraint, not an email one).
--
-- Frontend-first build: this migration ships the data layer the UI needs to
-- create and show jobs. The actual sending worker (bulk-email-dispatcher,
-- mirroring bulk-sms-dispatcher) isn't built yet — it needs real SMTP
-- credentials for the new sending identity, which don't exist until a
-- domain is bought. Jobs created before that exists will simply sit queued
-- until the dispatcher is deployed later; nothing about this schema needs
-- to change when that happens.
-- ============================================================================

alter table public.leads add column if not exists email_opted_out boolean not null default false;

create table public.bulk_email_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'paused')),
  error text,
  total int not null default 0,
  config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.bulk_email_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.bulk_email_jobs(id) on delete cascade,
  -- set null rather than cascade: a lead deleted mid-campaign (or after)
  -- shouldn't make its own send outcome disappear from the job's history.
  lead_id uuid references public.leads(id) on delete set null,
  lead_name text not null default '',
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  detail text,
  -- One-click unsubscribe, per send — a future unsubscribe-bulk-email
  -- function looks a lead up by this token and flips email_opted_out,
  -- without needing the lead to be signed in or the token to reveal
  -- anything about them beyond "this specific send."
  unsubscribe_token uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);

create index bulk_email_job_items_job_id_idx on public.bulk_email_job_items (job_id);
create index bulk_email_job_items_job_id_status_idx on public.bulk_email_job_items (job_id, status);
create unique index bulk_email_job_items_unsub_token_idx on public.bulk_email_job_items (unsubscribe_token);

-- Each row with its own sent/skipped/failed counts already aggregated, so
-- the history table isn't an N+1 count query per row — mirrors
-- bulk_sms_jobs_with_counts (0078) exactly.
create view public.bulk_email_jobs_with_counts
  with (security_invoker = true) as
select j.*,
  coalesce(c.sent, 0) as sent_count,
  coalesce(c.skipped, 0) as skipped_count,
  coalesce(c.failed, 0) as failed_count
from public.bulk_email_jobs j
left join lateral (
  select count(*) filter (where status = 'sent') as sent,
         count(*) filter (where status = 'skipped') as skipped,
         count(*) filter (where status = 'failed') as failed
  from public.bulk_email_job_items where job_id = j.id
) c on true;

alter table public.bulk_email_jobs enable row level security;
alter table public.bulk_email_job_items enable row level security;

create policy "bulk_email_jobs_select" on public.bulk_email_jobs
  for select using (public.current_role() = 'admin');

create policy "bulk_email_jobs_insert" on public.bulk_email_jobs
  for insert with check (public.current_role() = 'admin' and user_id = auth.uid());

create policy "bulk_email_jobs_delete" on public.bulk_email_jobs
  for delete using (public.current_role() = 'admin');

-- No client-side update policy — only the (future) dispatcher, running as
-- service role, advances a job's status and items, so the page's live view
-- can't be tampered with from the browser console into showing a fake
-- "sent". Same reasoning as bulk_sms_jobs (0046).

create policy "bulk_email_job_items_select" on public.bulk_email_job_items
  for select using (
    exists (select 1 from public.bulk_email_jobs j where j.id = job_id and public.current_role() = 'admin')
  );

create policy "bulk_email_job_items_insert" on public.bulk_email_job_items
  for insert with check (
    exists (
      select 1 from public.bulk_email_jobs j
      where j.id = job_id and j.user_id = auth.uid() and public.current_role() = 'admin'
    )
  );

-- Pause/resume — narrow, admin-only RPCs rather than opening the table up to
-- client UPDATEs generally. Mirrors pause_bulk_sms_job/resume_bulk_sms_job
-- (0062, 0086) exactly.
create or replace function public.pause_bulk_email_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'admin' then
    raise exception 'Admins only';
  end if;
  update public.bulk_email_jobs set status = 'paused', updated_at = now()
  where id = p_job_id and status = 'running';
end;
$$;

grant execute on function public.pause_bulk_email_job(uuid) to authenticated;

create or replace function public.resume_bulk_email_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'admin' then
    raise exception 'Admins only';
  end if;
  update public.bulk_email_jobs set status = 'running', error = null, updated_at = now()
  where id = p_job_id and status in ('failed', 'paused');
end;
$$;

grant execute on function public.resume_bulk_email_job(uuid) to authenticated;
