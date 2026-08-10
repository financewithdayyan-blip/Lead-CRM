-- Coordinates only, never the street address itself — a packet must never
-- carry or expose the subject's exact address. Geocoded admin-side from the
-- lead's real address and stored as bare numbers so the public map can draw
-- a proximity circle around the subject without ever plotting a pin on it
-- or revealing which point within the circle is the actual property.
alter table public.deal_packets add column if not exists subject_lat numeric;
alter table public.deal_packets add column if not exists subject_lng numeric;

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
    -- Quoted price = what Bluebird pays + the assignment fee.
    'purchasePrice',      case
                            when p.purchase_price is null then null
                            else p.purchase_price + coalesce(p.assignment_fee, 0)
                          end,
    'arv',                p.arv,
    'closingCost',        p.closing_cost,
    'assignmentFee',      case when p.show_assignment_fee then p.assignment_fee else null end,
    'showAssignmentFee',  p.show_assignment_fee,
    'dealTypes',          p.deal_types,
    'narrative',          p.narrative,
    'requireLeadCapture', p.require_lead_capture,
    'createdAt',          p.created_at,
    'subjectLat',         p.subject_lat,
    'subjectLng',         p.subject_lng,
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
    ), '[]'::json)
  )
  from public.deal_packets p
  where p.slug = p_slug and p.status = 'active';
$$;

revoke all on function public.get_public_packet(uuid) from public;
grant execute on function public.get_public_packet(uuid) to anon, authenticated;
