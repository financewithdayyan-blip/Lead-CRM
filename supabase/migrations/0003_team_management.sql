-- ============================================================================
-- Team management: collapse roles to admin/caller, add email-invite flow.
--
-- Existing 'manager' accounts are promoted to 'admin' (managers already had
-- read-only oversight; admin keeps that plus edit rights they didn't have
-- before - adjust specific accounts manually afterward if you'd rather they
-- become a plain 'caller' instead).
-- ============================================================================

update public.profiles set role = 'admin' where role = 'manager';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'caller'));
alter table public.profiles alter column role set default 'caller';

-- ── team_invites ────────────────────────────────────────────────────────────
create table public.team_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  role text not null default 'caller' check (role in ('admin', 'caller')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create index team_invites_owner_idx on public.team_invites (owner_id);
create index team_invites_email_idx on public.team_invites (lower(email));
-- Only one pending invite per owner+email at a time; past accepted/revoked
-- rows don't block re-inviting the same address later.
create unique index team_invites_pending_unique on public.team_invites (owner_id, lower(email)) where (status = 'pending');

alter table public.team_invites enable row level security;

create policy "team_invites_select" on public.team_invites
  for select using (owner_id = auth.uid());

create policy "team_invites_insert" on public.team_invites
  for insert with check (owner_id = auth.uid() and public.current_role() = 'admin');

create policy "team_invites_update" on public.team_invites
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "team_invites_delete" on public.team_invites
  for delete using (owner_id = auth.uid());

-- ── Auto-claim a pending invite when the invited email signs up ────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_invite record;
  v_role text;
begin
  v_code := upper(substr(replace(new.id::text, '-', ''), 1, 6));

  select * into v_invite
  from public.team_invites
  where lower(email) = lower(new.email) and status = 'pending'
  order by created_at asc
  limit 1;

  v_role := case
    when new.email = 'dayyan@bluebirdacquisition.com' then 'admin'
    when v_invite.id is not null then v_invite.role
    else 'caller'
  end;

  insert into public.profiles (id, email, full_name, user_code, role)
  values (new.id, new.email, split_part(coalesce(new.email, 'user'), '@', 1), v_code, v_role)
  on conflict (id) do nothing;

  if v_invite.id is not null then
    insert into public.team_members (owner_id, member_id)
    values (v_invite.owner_id, new.id)
    on conflict (owner_id, member_id) do nothing;

    update public.team_invites set status = 'accepted', accepted_at = now() where id = v_invite.id;
  end if;

  return new;
end;
$$;

-- ── Overseeing / adding team members is now admin-only (no more manager tier) ──
create or replace function public.is_team_overseer(target_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.profiles p on p.id = auth.uid()
    where tm.member_id = target_user_id
      and tm.owner_id = auth.uid()
      and p.role = 'admin'
  );
$$;

drop policy if exists "team_members_insert" on public.team_members;
create policy "team_members_insert" on public.team_members
  for insert with check (
    owner_id = auth.uid() and public.current_role() = 'admin'
  );
