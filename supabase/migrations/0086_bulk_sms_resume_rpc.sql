-- Now that bulk-sms-dispatcher (0085) owns advancing every running job,
-- Resume no longer needs to re-fetch queued leads and drive its own send —
-- it just needs to move the job back to 'running' so the dispatcher's next
-- tick (within ~60s) picks it back up. Mirrors pause_bulk_sms_job (0062)
-- exactly, just the reverse transition.
--
-- No client-side UPDATE policy exists on bulk_sms_jobs on purpose (see
-- 0046) — a narrow, admin-only RPC that can only ever move 'failed' or
-- 'paused' to 'running', nothing else.
create or replace function public.resume_bulk_sms_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'admin' then
    raise exception 'Admins only';
  end if;
  update public.bulk_sms_jobs set status = 'running', error = null, updated_at = now()
  where id = p_job_id and status in ('failed', 'paused');
end;
$$;

grant execute on function public.resume_bulk_sms_job(uuid) to authenticated;
