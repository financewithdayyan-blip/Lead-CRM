-- A big freeform paste field for everything an admin can find about a
-- property on Zillow (or any other public listing site) that doesn't have
-- its own structured field here -- description text, lot/parking/school
-- details, tax history, etc. Lives on both leads (where it's entered, on
-- the Property tab) and deal_packets (seeded from the lead at packet
-- creation, same pattern already used for repairs/comps/images/videos in
-- useCreatePacket) so it can also be shown on the investor-facing packet.
alter table public.leads add column if not exists property_listing_info text;
alter table public.deal_packets add column if not exists property_listing_info text;

-- Ungated on the public packet -- same treatment as narrative/propType/
-- beds/baths (see 0183's own comment on what's gated vs not): this is
-- Zillow-sourced description/spec content about the home itself, not a
-- proprietary number like repairs cost, comps, or margin.
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
    'id',                  v_packet.id,
    'slug',                v_packet.slug,
    'ownerName',           v_packet.owner_name,
    'propType',            v_packet.prop_type,
    'beds',                v_packet.beds,
    'baths',               v_packet.baths,
    'sqft',                v_packet.sqft,
    'yearBuilt',           v_packet.year_built,
    'market',              v_packet.market,
    'leadStatus',          v_packet.lead_status,
    'state',               v_packet.state,
    'purchasePrice',       case
                             when v_packet.purchase_price is null then null
                             else v_packet.purchase_price + coalesce(v_packet.assignment_fee, 0)
                           end,
    'arv',                 v_packet.arv,
    'arvIsManual',         v_packet.arv_is_manual,
    'closingCost',         case when v_captured then v_packet.closing_cost else null end,
    'assignmentFee',       case when v_captured and v_packet.show_assignment_fee then v_packet.assignment_fee else null end,
    'showAssignmentFee',   v_packet.show_assignment_fee,
    'dealTypes',           case when v_captured then v_packet.deal_types else '{}'::text[] end,
    'narrative',           v_packet.narrative,
    'propertyListingInfo', v_packet.property_listing_info,
    'requireLeadCapture',  v_packet.require_lead_capture,
    'createdAt',           v_packet.created_at,
    'subjectLat',          v_packet.subject_lat,
    'subjectLng',          v_packet.subject_lng,
    'compRadiusMiles',     v_packet.comp_radius_miles,
    'compRecencyMonths',   v_packet.comp_recency_months,
    'conditionRatings',    case when v_captured then v_packet.condition_ratings else '{}'::jsonb end,
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
