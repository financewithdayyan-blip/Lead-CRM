-- Hotfix for 0145: deal_packets.address was permanently dropped back in
-- 0031_drop_packet_address.sql ("no longer disclose an exact location under
-- any circumstance"), which 0145 missed — it referenced v_packet.address,
-- a column that no longer exists, breaking every log_packet_view call in
-- production (the INSERT into packet_views was even rolling back, since the
-- later error aborts the whole function). This restores a working function
-- that never references address, keeping the json return shape so the
-- frontend (which now expects one) doesn't need reverting. Always returns
-- null until a real decision is made about whether/how to reintroduce an
-- address reveal.

create or replace function public.log_packet_view(
  p_slug uuid,
  p_viewer_token text,
  p_viewer_name text default null,
  p_viewer_email text default null,
  p_viewer_phone text default null,
  p_user_agent text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_packet public.deal_packets%rowtype;
begin
  select * into v_packet from public.deal_packets where slug = p_slug and status = 'active';
  if not found then return null; end if;

  insert into public.packet_views
    (packet_id, lead_id, viewer_token, viewer_name, viewer_email, viewer_phone, user_agent)
  values
    (v_packet.id, v_packet.lead_id, p_viewer_token,
     nullif(p_viewer_name, ''), nullif(p_viewer_email, ''), nullif(p_viewer_phone, ''),
     nullif(p_user_agent, ''));

  return null;
end;
$$;

revoke all on function public.log_packet_view(uuid, text, text, text, text, text) from public;
grant execute on function public.log_packet_view(uuid, text, text, text, text, text) to anon, authenticated;
