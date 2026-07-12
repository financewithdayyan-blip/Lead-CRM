-- Migration 0020 created the initiated_by column, the receiver-visibility policy,
-- and the accept/decline helper functions, but was never applied to the live DB.
-- Migration 0025 (create or replace function admin_share_lead_to_caller) WAS applied,
-- leaving the function referencing a column that didn't exist. This migration adds
-- all the missing pieces so the admin→caller share flow works end-to-end.

-- 1. Add the missing column.
alter table public.lead_shares
  add column if not exists initiated_by uuid references public.profiles(id) on delete set null;

-- 2. Receiving caller can see the lead while a pending admin-initiated share targets them.
drop policy if exists "leads_select_via_pending_share_receiver" on public.leads;
create policy "leads_select_via_pending_share_receiver" on public.leads
  for select using (
    exists (
      select 1 from public.lead_shares ls
      where ls.lead_id = id
        and ls.to_user_id = auth.uid()
        and ls.status = 'pending'
    )
  );

-- 3. Receiving caller accepts an admin-initiated share.
create or replace function public.accept_admin_lead_share(
  p_share_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id      uuid;
  v_from_user_id uuid;
  v_to_user_id   uuid;
begin
  select lead_id, from_user_id, to_user_id
  into v_lead_id, v_from_user_id, v_to_user_id
  from public.lead_shares
  where id = p_share_id
    and status = 'pending'
    and to_user_id = auth.uid()
    and initiated_by is not null;

  if not found then
    raise exception 'Share not found or not authorized';
  end if;

  update public.lead_shares
  set status = 'accepted', resolved_at = now()
  where id = p_share_id;

  update public.leads
  set user_id = v_to_user_id
  where id = v_lead_id;

  update public.tasks
  set user_id = v_to_user_id
  where lead_id = v_lead_id and user_id = v_from_user_id;
end;
$$;

-- 4. Receiving caller declines an admin-initiated share.
create or replace function public.decline_admin_lead_share(
  p_share_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lead_shares
  set status = 'declined', resolved_at = now()
  where id = p_share_id
    and status = 'pending'
    and to_user_id = auth.uid()
    and initiated_by is not null;

  if not found then
    raise exception 'Share not found or not authorized';
  end if;
end;
$$;
