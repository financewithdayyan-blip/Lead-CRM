-- Fixes two real, confirmed issues found while investigating RLS-under-load
-- 500s on the leads fetch:
--
-- 1. Correctness: leads_select_via_pending_share and
--    leads_select_via_pending_share_receiver each correlate their EXISTS
--    subquery with a bare `id` inside `where ls.lead_id = id`. Since
--    lead_shares also has its own `id` column, Postgres resolves the
--    unqualified reference to the innermost match (ls.id) instead of the
--    intended outer leads.id — confirmed live via pg_policies, which shows
--    the bound SQL as `ls.lead_id = ls.id`. A lead_shares row's own lead_id
--    matching its own id is a UUID coincidence that essentially never
--    happens, so both policies have been silent no-ops since they were
--    written (migrations 0009, 0020): "let an admin/receiving-caller
--    preview a lead while a share on it is pending" has never actually
--    worked. Fails closed (denies wrongly, never leaks) — still a real
--    broken feature, fixed here by qualifying the reference correctly.
--
-- 2. Performance: EXPLAIN ANALYZE as the real `authenticated` role (not the
--    service-role key, which bypasses RLS and was the only thing measured
--    before) showed 89ms for 1000 rows, vs 2ms with RLS bypassed. The plan
--    showed why: current_role(), STABLE but referenced bare, gets invoked
--    once per row scanned instead of once per query, because Postgres
--    doesn't auto-hoist STABLE calls across rows unless the query lets it.
--    Wrapping in `(select ...)` is the standard Postgres/Supabase-documented
--    fix — forces a single InitPlan evaluation instead of one per row. This
--    is a pure caching hint: `(select auth.uid())` and `auth.uid()` are
--    guaranteed identical within one query (that's what STABLE means), so
--    no policy's set of visible/writable rows changes.

alter policy "leads_select" on public.leads
  using ((user_id = (select auth.uid())) or is_team_overseer(user_id));

alter policy "leads_select_via_pending_share" on public.leads
  using (
    (select public.current_role()) = 'admin'
    and exists (select 1 from public.lead_shares ls where ls.lead_id = leads.id and ls.status = 'pending')
  );

alter policy "leads_select_via_pending_share_receiver" on public.leads
  using (
    exists (
      select 1 from public.lead_shares ls
      where ls.lead_id = leads.id
        and ls.to_user_id = (select auth.uid())
        and ls.status = 'pending'
    )
  );

alter policy "leads_insert" on public.leads
  with check (
    (user_id = (select auth.uid()))
    or (is_team_overseer(user_id) and (select public.current_role()) = 'admin')
  );

alter policy "leads_update" on public.leads
  using (
    (user_id = (select auth.uid()))
    or (is_team_overseer(user_id) and (select public.current_role()) = 'admin')
  )
  with check (
    (user_id = (select auth.uid()))
    or (is_team_overseer(user_id) and (select public.current_role()) = 'admin')
  );

alter policy "leads_delete" on public.leads
  using (
    (user_id = (select auth.uid()))
    or (is_team_overseer(user_id) and (select public.current_role()) = 'admin')
  );

create or replace function public.is_team_overseer(target_user_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and exists (
        select 1 from public.team_members tm where tm.member_id = target_user_id
      )
  );
$function$;

-- is_team_overseer's subquery filters on member_id, which today only has a
-- composite (owner_id, member_id) index it can't use efficiently for this
-- lookup — matters specifically when an admin views a team member's leads,
-- since is_team_overseer can't short-circuit away there the way it does for
-- someone viewing their own leads.
create index if not exists team_members_member_id_idx on public.team_members (member_id);
