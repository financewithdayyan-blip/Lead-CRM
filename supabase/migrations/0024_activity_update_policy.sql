-- Missing UPDATE policy on lead_activities caused the inline note editor to
-- appear to save but never persist — Supabase RLS with no UPDATE policy
-- silently blocks all updates (0 rows changed, no error thrown).
-- Allow the author to edit their own activity, and an overseer admin to edit
-- any activity on a lead they manage.
create policy "lead_activities_update" on public.lead_activities
  for update
  using (
    user_id = auth.uid()
    or (
      public.current_role() = 'admin'
      and exists (
        select 1 from public.leads l
        where l.id = lead_activities.lead_id
          and public.is_team_overseer(l.user_id)
      )
    )
  )
  with check (
    user_id = auth.uid()
    or (
      public.current_role() = 'admin'
      and exists (
        select 1 from public.leads l
        where l.id = lead_activities.lead_id
          and public.is_team_overseer(l.user_id)
      )
    )
  );
