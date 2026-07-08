-- Admin-initiated shares previously required the receiving caller to approve
-- when the lead was in the followup stage. Admins should not need any caller
-- approval — the transfer always happens immediately regardless of stage.
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
  values (p_lead_id, v_from_user_id, p_to_user_id, v_lead_stage, 'accepted', auth.uid())
  returning id into v_share_id;

  update public.lead_shares
  set resolved_at = now()
  where id = v_share_id;

  update public.leads
  set user_id = p_to_user_id
  where id = p_lead_id;

  update public.tasks
  set user_id = p_to_user_id
  where lead_id = p_lead_id and user_id = v_from_user_id;

  return v_share_id;
end;
$$;
