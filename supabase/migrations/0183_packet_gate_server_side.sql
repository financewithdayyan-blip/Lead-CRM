-- get_public_packet returned every field unconditionally, regardless of
-- require_lead_capture -- purchase price, ARV, closing cost, assignment
-- fee, the full comp list (addresses + actual sale prices), the repair
-- line items, condition ratings, deal types, and videos were all sent to
-- any visitor on the very first page load, before the lead-capture gate
-- was ever shown or satisfied. "Gated" was purely a client-side boolean
-- (PublicPacketPage's `gated`, driven by an unauthenticated localStorage
-- value) deciding what to RENDER -- the data itself was always already
-- delivered. Anyone opening devtools' Network tab, or hand-setting the
-- localStorage identity key, saw the full deal economics without ever
-- submitting real contact info, defeating the gate's entire purpose.
--
-- Fixed by extending the same server-verified-capture standard
-- log_packet_view (0145) already uses for the street address: a real
-- packet_views row, for this exact browser's viewer_token, carrying a
-- non-null phone number. Gated here: closing_cost, assignment_fee, the
-- comps array, the repairs array, condition_ratings, deal_types, and
-- videos -- the fields that are never shown anywhere on the gate screen
-- itself (LeadCaptureGate in PublicPacketPage.tsx). purchase_price and
-- arv are deliberately left UNGATED here, matching that screen's own
-- already-shipped design: it intentionally teases with exactly those two
-- headline numbers ("dealStats={statItems.filter(s => s.label ===
-- 'Sale Price' || s.label === 'ARV')}") while withholding repair scope
-- and margin -- gating them server-side too would contradict a deliberate
-- product decision, not fix a bug. images stay ungated too: the gate
-- screen already shows a blurred teaser of the first photo by design, and
-- photos alone aren't the proprietary underwriting data this fix targets.
--
-- Switched from a plain SQL function to plpgsql since the captured check
-- now needs to be computed once and reused across several fields, not
-- feasible to express cleanly as a single SQL expression.
--
-- The old single-argument overload is dropped outright rather than left
-- alongside the new one -- a default parameter does not change a
-- function's signature for overload-resolution purposes, so simply
-- defining get_public_packet(uuid, text default null) would have left the
-- old get_public_packet(uuid) reachable and still fully unprotected.
drop function if exists public.get_public_packet(uuid);

create or replace function public.get_public_packet(p_slug uuid, p_viewer_token text default null)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_packet   public.deal_packets%rowtype;
  v_captured boolean;
begin
  select * into v_packet from public.deal_packets where slug = p_slug and status = 'active';
  if not found then return null; end if;

  v_captured := (not v_packet.require_lead_capture) or exists (
    select 1 from public.packet_views pv
    where pv.packet_id = v_packet.id
      and pv.viewer_token = p_viewer_token
      and pv.viewer_phone is not null
  );

  return json_build_object(
    'id',                 v_packet.id,
    'slug',               v_packet.slug,
    'ownerName',          v_packet.owner_name,
    'propType',           v_packet.prop_type,
    'beds',               v_packet.beds,
    'baths',              v_packet.baths,
    'sqft',               v_packet.sqft,
    'yearBuilt',          v_packet.year_built,
    'market',             v_packet.market,
    'leadStatus',         v_packet.lead_status,
    'state',              v_packet.state,
    'purchasePrice',      case
                            when v_packet.purchase_price is null then null
                            else v_packet.purchase_price + coalesce(v_packet.assignment_fee, 0)
                          end,
    'arv',                v_packet.arv,
    'arvIsManual',        v_packet.arv_is_manual,
    'closingCost',        case when v_captured then v_packet.closing_cost else null end,
    'assignmentFee',      case when v_captured and v_packet.show_assignment_fee then v_packet.assignment_fee else null end,
    'showAssignmentFee',  v_packet.show_assignment_fee,
    'dealTypes',          case when v_captured then v_packet.deal_types else '{}'::text[] end,
    'narrative',          v_packet.narrative,
    'requireLeadCapture', v_packet.require_lead_capture,
    'createdAt',          v_packet.created_at,
    'subjectLat',         v_packet.subject_lat,
    'subjectLng',         v_packet.subject_lng,
    'compRadiusMiles',    v_packet.comp_radius_miles,
    'compRecencyMonths',  v_packet.comp_recency_months,
    'conditionRatings',   case when v_captured then v_packet.condition_ratings else '{}'::jsonb end,
    'comps', case when not v_captured then '[]'::json else coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'kind', c.kind, 'address', c.address, 'salePrice', c.sale_price,
        'saleDate', c.sale_date, 'sqft', c.sqft, 'beds', c.beds, 'baths', c.baths,
        'lat', c.lat, 'lng', c.lng
      ) order by c.sort_order)
      from public.packet_comps c where c.packet_id = v_packet.id
    ), '[]'::json) end,
    'repairs', case when not v_captured then '[]'::json else coalesce((
      select json_agg(json_build_object('id', r.id, 'item', r.item, 'cost', r.cost)
                      order by r.sort_order)
      from public.packet_repairs r where r.packet_id = v_packet.id
    ), '[]'::json) end,
    'images', coalesce((
      select json_agg(json_build_object(
        'id', i.id, 'storagePath', i.storage_path, 'caption', i.caption
      ) order by i.sort_order)
      from public.packet_images i where i.packet_id = v_packet.id
    ), '[]'::json),
    'videos', case when not v_captured then '[]'::json else coalesce((
      select json_agg(json_build_object(
        'id', vi.id, 'storagePath', vi.storage_path, 'caption', vi.caption
      ) order by vi.sort_order)
      from public.packet_videos vi where vi.packet_id = v_packet.id
    ), '[]'::json) end
  );
end;
$$;

grant execute on function public.get_public_packet(uuid, text) to anon, authenticated;
