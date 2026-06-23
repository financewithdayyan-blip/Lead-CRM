-- Admins overseeing a team member can now delete their leads too, matching
-- the edit permission they already have (leads_update already allows this;
-- leads_delete was still owner-only).
drop policy if exists "leads_delete" on public.leads;
create policy "leads_delete" on public.leads
  for delete using (
    user_id = auth.uid()
    or (public.is_team_overseer(user_id) and public.current_role() = 'admin')
  );
