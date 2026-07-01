-- Allow any authenticated user to read any profile's basic info.
-- Needed so activity notes can show the author's name regardless of who is viewing.
-- Profiles contain only internal CRM user data (name, role, daily goal) — no secrets.
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated
  using (true);
