-- Packets can now carry current listings alongside sold comps, and both can be
-- plotted on a map.
--
-- Reuses packet_comps rather than adding a parallel table: a listing and a sold
-- comp hold exactly the same fields (address, price, sq ft, a date), and one
-- table keeps ordering, the builder and the map on a single code path. `kind`
-- separates them.

alter table public.packet_comps
  add column if not exists kind text not null default 'sold'
    check (kind in ('sold', 'listing'));

-- Geocoded once on save, admin-side, so the public page never calls a geocoder.
alter table public.packet_comps add column if not exists lat numeric;
alter table public.packet_comps add column if not exists lng numeric;

-- Republished so the public payload carries kind and coordinates. Comps are
-- returned in one array and split by kind on the client.
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
        'id', c.id, 'kind', c.kind, 'address', c.address, 'salePrice', c.sale_price,
        'saleDate', c.sale_date, 'sqft', c.sqft, 'lat', c.lat, 'lng', c.lng
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
