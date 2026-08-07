-- Lets an admin clear old bulk send history from the All Sends list.
-- bulk_sms_job_items already cascades on delete (see 0046), so removing the
-- job row is enough to clean up its per-lead rows too.
create policy "bulk_sms_jobs_delete" on public.bulk_sms_jobs
  for delete using (public.current_role() = 'admin');
