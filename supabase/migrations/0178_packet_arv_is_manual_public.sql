-- Exposes arv_is_manual through get_public_packet so the public page can
-- tell a manually-entered ARV apart from the auto-computed comparable
-- average. Without this the public page always recomputed its own "market"
-- value from the live comps array and showed THAT instead of whatever the
-- admin actually typed into "Enter ARV manually" — the flag existed on the
-- row the whole time, it just never left the database.

create or replace function public.get_public_packet(p_slug uuid)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'id',                 p.id,
    'slug',               p.slug,
    'ownerName',          p.owner_name,
    'propType',           p.prop_type,
    'beds',               p.beds,
    'baths',              p.baths,
    'sqft',               p.sqft,
    'yearBuilt',          p.year_built,
    'market',             p.market,
    'leadStatus',         p.lead_status,
    'state',              p.state,
    'purchasePrice',      case
                            when p.purchase_price is null then null
                            else p.purchase_price + coalesce(p.assignment_fee, 0)
                          end,
    'arv',                p.arv,
    'arvIsManual',        p.arv_is_manual,
    'closingCost',        p.closing_cost,
    'assignmentFee',      case when p.show_assignment_fee then p.assignment_fee else null end,
    'showAssignmentFee',  p.show_assignment_fee,
    'dealTypes',          p.deal_types,
    'narrative',          p.narrative,
    'requireLeadCapture', p.require_lead_capture,
    'createdAt',          p.created_at,
    'subjectLat',         p.subject_lat,
    'subjectLng',         p.subject_lng,
    'compRadiusMiles',    p.comp_radius_miles,
    'compRecencyMonths',  p.comp_recency_months,
    'conditionRatings',   p.condition_ratings,
    'comps', coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'kind', c.kind, 'address', c.address, 'salePrice', c.sale_price,
        'saleDate', c.sale_date, 'sqft', c.sqft, 'beds', c.beds, 'baths', c.baths,
        'lat', c.lat, 'lng', c.lng
      ) order by c.sort_order)
      from public.packet_comps c where c.packet_id = p.id
    ), '[]'::json),
    'repairs', coalesce((
      select json_agg(json_build_object('id', r.id, 'item', r.item, 'cost', r.cost)
                      order by r.sort_order)
      from public.packet_repairs r where r.packet_id = p.id
    ), '[]'::json),
    'images', coalesce((
      select json_agg(json_build_object(
        'id', i.id, 'storagePath', i.storage_path, 'caption', i.caption
      ) order by i.sort_order)
      from public.packet_images i where i.packet_id = p.id
    ), '[]'::json),
    'videos', coalesce((
      select json_agg(json_build_object(
        'id', v.id, 'storagePath', v.storage_path, 'caption', v.caption
      ) order by v.sort_order)
      from public.packet_videos v where v.packet_id = p.id
    ), '[]'::json)
  )
  from public.deal_packets p
  where p.slug = p_slug and p.status = 'active';
$$;

revoke all on function public.get_public_packet(uuid) from public;
grant execute on function public.get_public_packet(uuid) to anon, authenticated;
