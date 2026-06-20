-- ============================================================================
-- Profile directory (for "add team member by code" lookup) + Storage policies
-- ============================================================================

-- Minimal, non-sensitive view so any signed-in user can be found by an
-- admin/manager via their user_code before a team_members relationship
-- exists (chicken-and-egg: is_team_overseer() can't help you find someone
-- you don't yet oversee). Deliberately omits role/goals/etc.
create or replace view public.profile_directory
  with (security_invoker = false) as
  select id, user_code, caller_name, email
  from public.profiles;

grant select on public.profile_directory to authenticated;

-- Only admins/managers may actually use the directory in practice, but that's
-- enforced at the team_members insert policy (0002), not here — the
-- directory itself just exposes lookup, never write access.

-- ── Storage bucket for lead photos ──────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('lead-photos', 'lead-photos', false)
on conflict (id) do nothing;

-- Object paths are namespaced "<user_id>/<lead_id>/<filename>" by convention
-- (enforced client-side on upload); policies check the leading folder against
-- auth.uid() and team oversight.
create policy "lead_photos_storage_select" on storage.objects
  for select using (
    bucket_id = 'lead-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_team_overseer(((storage.foldername(name))[1])::uuid)
    )
  );

create policy "lead_photos_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'lead-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "lead_photos_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'lead-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
