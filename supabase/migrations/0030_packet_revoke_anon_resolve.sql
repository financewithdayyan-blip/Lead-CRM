-- resolve_address_request is admin-only, but it landed with EXECUTE granted to
-- anon. `revoke ... from public` in 0029 does not strip that: Supabase's default
-- privileges grant EXECUTE to anon on new functions in the public schema
-- independently of the PUBLIC role, so it has to be revoked by name.
--
-- Not exploitable as it stands — the function checks auth.uid() against the
-- packet owner and raises for an anonymous caller — but nothing anonymous
-- should be able to call an approval function at all.

revoke execute on function public.resolve_address_request(uuid, boolean) from anon;
