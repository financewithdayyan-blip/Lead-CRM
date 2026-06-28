-- Any admin (not just the specific overseer who added someone to their own
-- team roster) can see every profile and every daily summary, so a caller's
-- submission reaches all admins, not just the one who happened to invite them.
create policy "profiles_select_admin" on public.profiles
  for select using (public.current_role() = 'admin');

create policy "daily_summaries_select_admin" on public.daily_summaries
  for select using (public.current_role() = 'admin');
