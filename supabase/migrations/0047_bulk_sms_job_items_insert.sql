-- 0046 enabled RLS on bulk_sms_job_items with a select policy only — with no
-- insert policy, RLS denies by default, so useCreateBulkSmsJob's own insert
-- (run as the signed-in admin, not the service role) would have failed
-- outright. Missed when writing 0046; caught before this ever shipped.
create policy "bulk_sms_job_items_insert" on public.bulk_sms_job_items
  for insert with check (
    exists (
      select 1 from public.bulk_sms_jobs j
      where j.id = job_id and j.user_id = auth.uid() and public.current_role() = 'admin'
    )
  );
