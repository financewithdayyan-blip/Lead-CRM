-- ============================================================================
-- Bulk SMS jobs — lets the Bulk SMS page show a live queue (queued / sending
-- / sent / failed / skipped) per lead instead of a single blocking spinner
-- that only reveals a result once the whole batch finishes.
--
-- send-sms writes to these as it works through a batch; the page polls
-- bulk_sms_job_items for the job to render progress. Admin-only, same as
-- send_log which this sits alongside.
-- ============================================================================

create table public.bulk_sms_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  error text,
  total int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bulk_sms_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.bulk_sms_jobs(id) on delete cascade,
  -- set null rather than cascade: a lead deleted mid-campaign (or after)
  -- shouldn't make its own send outcome disappear from the job's history.
  lead_id uuid references public.leads(id) on delete set null,
  lead_name text not null default '',
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  sent_from text,
  detail text,
  updated_at timestamptz not null default now()
);

create index bulk_sms_job_items_job_id_idx on public.bulk_sms_job_items (job_id);

alter table public.bulk_sms_jobs enable row level security;
alter table public.bulk_sms_job_items enable row level security;

create policy "bulk_sms_jobs_select" on public.bulk_sms_jobs
  for select using (public.current_role() = 'admin');

create policy "bulk_sms_jobs_insert" on public.bulk_sms_jobs
  for insert with check (public.current_role() = 'admin' and user_id = auth.uid());

-- No client-side update policy — only send-sms (service role) advances a
-- job's status and items, so the page's live view can't be tampered with
-- from the browser console into showing a fake "sent".

create policy "bulk_sms_job_items_select" on public.bulk_sms_job_items
  for select using (
    exists (select 1 from public.bulk_sms_jobs j where j.id = job_id and public.current_role() = 'admin')
  );
