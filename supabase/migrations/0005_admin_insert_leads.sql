-- Admins overseeing a team member can now create leads (and tags/tag
-- assignments for them) on that member's behalf - e.g. CSV import or
-- "Add Lead" from the member's View As page. Mirrors the admin-overseer
-- exception already on leads_update/leads_delete.

drop policy if exists "leads_insert" on public.leads;
create policy "leads_insert" on public.leads
  for insert with check (
    user_id = auth.uid()
    or (public.is_team_overseer(user_id) and public.current_role() = 'admin')
  );

drop policy if exists "tags_insert" on public.tags;
create policy "tags_insert" on public.tags
  for insert with check (
    user_id = auth.uid()
    or (public.is_team_overseer(user_id) and public.current_role() = 'admin')
  );

drop policy if exists "lead_tags_write" on public.lead_tags;
create policy "lead_tags_write" on public.lead_tags
  for all using (
    exists (
      select 1 from public.leads l
      where l.id = lead_id
        and (l.user_id = auth.uid() or (public.is_team_overseer(l.user_id) and public.current_role() = 'admin'))
    )
  ) with check (
    exists (
      select 1 from public.leads l
      where l.id = lead_id
        and (l.user_id = auth.uid() or (public.is_team_overseer(l.user_id) and public.current_role() = 'admin'))
    )
  );
