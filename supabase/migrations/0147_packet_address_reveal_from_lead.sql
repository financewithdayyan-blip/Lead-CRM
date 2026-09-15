-- ============================================================================
-- Deal packet address auto-reveal — for real this time.
--
-- 0031_drop_packet_address.sql deliberately deleted deal_packets.address
-- ("no longer disclose an exact location under any circumstance"), which
-- 0145/0146 didn't account for. Explicitly confirmed with the business
-- owner (2026-09-15) that this is now wanted: once a visitor has passed
-- the lead-capture gate (name + phone — the same moment log_packet_view
-- already fires with a phone present), the full street address should be
-- revealed automatically.
--
-- The address itself was never deleted from the source of truth — every
-- packet is generated from a lead, and leads.address is untouched — so
-- this reads it live from there via deal_packets.lead_id rather than
-- reintroducing a duplicate column on deal_packets.
-- ============================================================================

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
  v_lead_address text;
  v_address json;
begin
  select * into v_packet from public.deal_packets where slug = p_slug and status = 'active';
  if not found then return null; end if;

  insert into public.packet_views
    (packet_id, lead_id, viewer_token, viewer_name, viewer_email, viewer_phone, user_agent)
  values
    (v_packet.id, v_packet.lead_id, p_viewer_token,
     nullif(p_viewer_name, ''), nullif(p_viewer_email, ''), nullif(p_viewer_phone, ''),
     nullif(p_user_agent, ''));

  if nullif(p_viewer_phone, '') is not null then
    select l.address into v_lead_address from public.leads l where l.id = v_packet.lead_id;
    v_address := json_build_object(
      'address', v_lead_address,
      'city',    v_packet.city,
      'state',   v_packet.state,
      'zip',     v_packet.zip
    );
  end if;

  return v_address;
end;
$$;

revoke all on function public.log_packet_view(uuid, text, text, text, text, text) from public;
grant execute on function public.log_packet_view(uuid, text, text, text, text, text) to anon, authenticated;
