-- Lets the "All Sends" history table show sent/skipped/failed per job
-- without an N+1 count query per row. security_invoker so the view carries
-- the same admin-only RLS as the underlying tables rather than the view
-- owner's own privileges.
create view public.bulk_sms_jobs_with_counts
  with (security_invoker = true) as
select
  j.*,
  coalesce(c.sent, 0) as sent_count,
  coalesce(c.skipped, 0) as skipped_count,
  coalesce(c.failed, 0) as failed_count
from public.bulk_sms_jobs j
left join lateral (
  select
    count(*) filter (where status = 'sent') as sent,
    count(*) filter (where status = 'skipped') as skipped,
    count(*) filter (where status = 'failed') as failed
  from public.bulk_sms_job_items
  where job_id = j.id
) c on true;

-- A cap on how many leads a single bulk send will ever actually queue,
-- separate from the existing per-number rolling 24h limits. Selecting 7,000
-- leads in the Pipeline with this set to 1,800 only queues the first 1,800 —
-- the point is to make "select the whole Cold column" safe to do by hand
-- without also needing to remember to trim the selection first. 0 means no
-- cap, same convention as the per-number limits.
alter table public.sms_send_settings add column daily_total_limit int not null default 0;
