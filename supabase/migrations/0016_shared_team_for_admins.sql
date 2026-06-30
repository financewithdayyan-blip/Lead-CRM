-- Any admin should see the entire shared team roster, not just members they
-- personally invited. Also allows any admin to remove any member, and fixes
-- is_team_overseer() so any admin can view/edit any caller's data.

-- ── team_members SELECT: any admin can read all rows ─────────────────────────
drop policy if exists "team_members_select" on public.team_members;
create policy "team_members_select" on public.team_members
  for select using (
    owner_id = auth.uid()
    or member_id = auth.uid()
    or public.current_role() = 'admin'
  );

-- ── team_members DELETE: any admin can remove any member ─────────────────────
drop policy if exists "team_members_delete" on public.team_members;
create policy "team_members_delete" on public.team_members
  for delete using (
    owner_id = auth.uid()
    or public.current_role() = 'admin'
  );

-- ── is_team_overseer: any admin can oversee any caller in the team ───────────
-- Previously checked owner_id = auth.uid(), which meant only the admin who
-- personally invited someone could oversee them. Now: any admin can oversee
-- any user who appears as a member_id in team_members.
create or replace function public.is_team_overseer(target_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and exists (
        select 1 from public.team_members tm where tm.member_id = target_user_id
      )
  );
$$;
