-- An overseeing admin could already pass leads_update's RLS check to change
-- a team member's lead stage, but the AFTER UPDATE trigger that logs the
-- change always inserts under the lead's owner (new.user_id), never the
-- admin's own auth.uid(). lead_activities_insert's own RLS then rejected
-- that insert (user_id <> auth.uid()), rolling back the whole stage change -
-- which is why admins couldn't drag cards on a team member's Kanban board.
-- This is a system-generated audit row, not a user-initiated write, so let
-- it bypass RLS like the other system triggers in this app (handle_new_user).
create or replace function public.log_lead_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage is distinct from old.stage then
    insert into public.lead_activities (lead_id, user_id, type, meta)
    values (new.id, new.user_id, 'stage_change', jsonb_build_object('from', old.stage, 'to', new.stage));
  end if;
  return new;
end;
$$;

-- Let an overseeing admin manually log an activity/note on a team member's
-- lead too (attributed to the admin themselves, same as before).
drop policy if exists "lead_activities_insert" on public.lead_activities;
create policy "lead_activities_insert" on public.lead_activities
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.leads l
      where l.id = lead_activities.lead_id
        and (l.user_id = auth.uid() or (public.is_team_overseer(l.user_id) and public.current_role() = 'admin'))
    )
  );

-- Same admin-overseer exception leads_update/lead_tags_write already have,
-- so admins can create/complete/delete tasks on a team member's lead.
drop policy if exists "tasks_write" on public.tasks;
create policy "tasks_write" on public.tasks
  for all
  using (user_id = auth.uid() or (public.is_team_overseer(user_id) and public.current_role() = 'admin'))
  with check (user_id = auth.uid() or (public.is_team_overseer(user_id) and public.current_role() = 'admin'));

-- Same exception for comps (add/edit/delete) on a team member's lead.
drop policy if exists "lead_comps_write" on public.lead_comps;
create policy "lead_comps_write" on public.lead_comps
  for all
  using (
    exists (
      select 1 from public.leads l
      where l.id = lead_comps.lead_id
        and (l.user_id = auth.uid() or (public.is_team_overseer(l.user_id) and public.current_role() = 'admin'))
    )
  )
  with check (
    exists (
      select 1 from public.leads l
      where l.id = lead_comps.lead_id
        and (l.user_id = auth.uid() or (public.is_team_overseer(l.user_id) and public.current_role() = 'admin'))
    )
  );
