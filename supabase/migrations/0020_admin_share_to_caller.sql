-- Allow admins to share/transfer leads from one caller to another caller.
-- Followup-stage leads require the receiving caller's approval (stay pending).
-- All other stages transfer immediately (auto-accepted).

-- 1. Track who initiated the share; null = caller-initiated (existing flow).
alter table public.lead_shares
  add column if not exists initiated_by uuid references public.profiles(id) on delete set null;

-- 2. Receiving caller can see the lead while a pending share targets them.
--    (Admin already has visibility via the existing leads_select_via_pending_share policy.)
create policy "leads_select_via_pending_share_receiver" on public.leads
  for select using (
    exists (
      select 1 from public.lead_shares ls
      where ls.lead_id = id
        and ls.to_user_id = auth.uid()
        and ls.status = 'pending'
    )
  );

-- 3. Admin initiates a share from one caller to another.
--    Followup leads stay pending; all other stages auto-accept immediately.
create or replace function public.admin_share_lead_to_caller(
  p_lead_id    uuid,
  p_to_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share_id     uuid;
  v_lead_stage   text;
  v_from_user_id uuid;
begin
  if public.current_role() <> 'admin' then
    raise exception 'Only admins can share leads to callers';
  end if;

  select user_id, stage
  into v_from_user_id, v_lead_stage
  from public.leads
  where id = p_lead_id;

  if not found then
    raise exception 'Lead not found';
  end if;

  if v_from_user_id = p_to_user_id then
    raise exception 'Cannot share a lead with its current owner';
  end if;

  insert into public.lead_shares (lead_id, from_user_id, to_user_id, stage_at_share, status, initiated_by)
  values (p_lead_id, v_from_user_id, p_to_user_id, v_lead_stage, 'pending', auth.uid())
  returning id into v_share_id;

  -- Non-followup leads transfer immediately — no approval needed.
  if v_lead_stage <> 'followup' then
    update public.lead_shares
    set status = 'accepted', resolved_at = now()
    where id = v_share_id;

    update public.leads
    set user_id = p_to_user_id
    where id = p_lead_id;

    update public.tasks
    set user_id = p_to_user_id
    where lead_id = p_lead_id and user_id = v_from_user_id;
  end if;

  return v_share_id;
end;
$$;

-- 4. Receiving caller accepts an admin-initiated share.
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

-- 5. Receiving caller declines an admin-initiated share.
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
