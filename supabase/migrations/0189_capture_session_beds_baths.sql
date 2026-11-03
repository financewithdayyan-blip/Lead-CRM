-- The guided capture shot list now derives its Room/Bath step count from
-- the lead's own beds/baths (CapturePage builds "Room 1".."Room N" / "Bath
-- 1".."Bath N" from these) instead of asking the seller to choose "add
-- another?" interactively — so the public, token-scoped session read needs
-- to expose these two numbers alongside what it already returns. Still
-- nothing else about the lead.
create or replace function public.get_capture_session(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_session public.photo_capture_sessions%rowtype;
  v_lead public.leads%rowtype;
begin
  select * into v_session from public.photo_capture_sessions where token = p_token;
  if not found then return null; end if;
  select * into v_lead from public.leads where id = v_session.lead_id;

  return json_build_object(
    'status', v_session.status,
    'photosCount', v_session.photos_count,
    'firstName', v_lead.first_name,
    'address', v_lead.address,
    'city', v_lead.city,
    'state', v_lead.state,
    'beds', v_lead.beds,
    'baths', v_lead.baths
  );
end;
$$;

grant execute on function public.get_capture_session(uuid) to anon, authenticated;
