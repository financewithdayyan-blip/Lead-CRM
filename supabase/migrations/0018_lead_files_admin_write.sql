-- Allow admins (team overseers) to upload/delete files on leads they oversee.
-- Previously only the lead owner could write to lead_files.

drop policy if exists "lead_files_write" on public.lead_files;

create policy "lead_files_write" on public.lead_files
  for all
  using (
    exists (
      select 1 from public.leads l
      where l.id = lead_files.lead_id
        and (l.user_id = auth.uid() or public.is_team_overseer(l.user_id))
    )
  )
  with check (
    exists (
      select 1 from public.leads l
      where l.id = lead_files.lead_id
        and (l.user_id = auth.uid() or public.is_team_overseer(l.user_id))
    )
  );
