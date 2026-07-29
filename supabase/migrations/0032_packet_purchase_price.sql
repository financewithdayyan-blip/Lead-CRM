-- Deal analysis needs to know what the investor actually pays. The packet
-- carried ARV, repairs and the assignment fee but no purchase price, so a
-- viewer had no way to judge the deal — and nor did any scoring we layered on
-- top of it.

alter table public.deal_packets add column if not exists purchase_price numeric;

-- Republished with purchase_price included. Still no address column anywhere in
-- the returned object.
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
    'purchasePrice',      p.purchase_price,
    'arv',                p.arv,
    'assignmentFee',      case when p.show_assignment_fee then p.assignment_fee else null end,
    'showAssignmentFee',  p.show_assignment_fee,
    'dealTypes',          p.deal_types,
    'narrative',          p.narrative,
    'requireLeadCapture', p.require_lead_capture,
    'createdAt',          p.created_at,
    'comps', coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'address', c.address, 'salePrice', c.sale_price,
        'saleDate', c.sale_date, 'sqft', c.sqft
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
