-- ============================================================================
-- Deal packet address auto-reveal.
--
-- log_packet_view already fires exactly once per page load once the lead-
-- capture gate is satisfied (see PublicPacketPage.tsx), carrying whatever
-- name/phone the visitor just gave (or already had on file from a prior
-- visit). That is precisely "once we have the number and name of the
-- person" — so the full street address is now handed back in that same
-- call whenever a phone is present, instead of requiring the separate
-- get_packet_address()/packet_address_requests approval flow (which stays
-- in place, untouched, for any future manual-review use — this just adds
-- an automatic path alongside it).
--
-- Return type changes from void to json, which Postgres won't allow via a
-- bare CREATE OR REPLACE, so the old signature is dropped first.
-- ============================================================================

drop function if exists public.log_packet_view(uuid, text, text, text, text, text);

create function public.log_packet_view(
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
    v_address := json_build_object(
      'address', v_packet.address,
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
