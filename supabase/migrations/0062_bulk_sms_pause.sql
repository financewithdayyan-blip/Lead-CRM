-- Lets an admin stop a running bulk send mid-flight and pick it back up
-- later — the client-side chunk loop (useSms.ts) checks for 'paused'
-- between batches and stops dispatching further ones; Resume (already built
-- for a failed job) already only needs the job's saved config and its
-- still-queued items, so a paused job resumes through that exact same path.
alter table public.bulk_sms_jobs drop constraint bulk_sms_jobs_status_check;
alter table public.bulk_sms_jobs add constraint bulk_sms_jobs_status_check
  check (status in ('running', 'completed', 'failed', 'paused'));

-- No client-side UPDATE policy exists on this table on purpose (see 0046 —
-- the live view can't be tampered with into showing a fake 'sent' from the
-- browser console). Pausing needs a narrow, admin-only exception rather than
-- opening the table up generally, so it's a dedicated RPC instead: it can
-- only ever move a job from 'running' to 'paused', nothing else.
create or replace function public.pause_bulk_sms_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'admin' then
    raise exception 'Admins only';
  end if;
  update public.bulk_sms_jobs set status = 'paused', updated_at = now()
  where id = p_job_id and status = 'running';
end;
$$;

grant execute on function public.pause_bulk_sms_job(uuid) to authenticated;
