-- ============================================================================
-- Backfill profiles for auth.users rows that already existed before the
-- on_auth_user_created trigger (0002) was installed. Safe to re-run.
-- ============================================================================

insert into public.profiles (id, email, caller_name, user_code, role)
select
  u.id,
  u.email,
  split_part(coalesce(u.email, 'user'), '@', 1),
  upper(substr(replace(u.id::text, '-', ''), 1, 6)),
  case when u.email = 'dayyan@bluebirdacquisition.com' then 'admin' else 'rep' end
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;
