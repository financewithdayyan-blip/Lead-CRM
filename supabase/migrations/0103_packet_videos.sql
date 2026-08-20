-- ============================================================================
-- Deal Packet videos — same shape as packet_images, and the same reason for
-- existing: a Deal Packet is viewed by an unauthenticated investor, so any
-- media it shows has to live in a public bucket. A lead's own video lives in
-- the private lead-files bucket, so it still has to be copied across the same
-- way useCopyLeadFileToPacket already does for photos.
-- ============================================================================

create table public.packet_videos (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.deal_packets(id) on delete cascade,
  storage_path text not null,
  caption      text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index packet_videos_packet_id_idx on public.packet_videos (packet_id);

alter table public.packet_videos enable row level security;

create policy "packet_videos_all" on public.packet_videos
  for all using (
    exists (select 1 from public.deal_packets p where p.id = packet_id
            and (p.user_id = auth.uid()
                 or (public.is_team_overseer(p.user_id) and public.current_role() = 'admin')))
  );

-- ============================================================================
-- get_public_packet — adds a videos array alongside images. Everything else
-- carried over unchanged from 0073_deal_packet_subject_geo.sql.
-- ============================================================================

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

grant execute on function public.get_public_packet(uuid) to anon, authenticated;

-- ============================================================================
-- Storage — public bucket, same access pattern as packet-images: write
-- requires an authenticated session, read is open (the bucket itself is
-- public), paths are {packet_id}/{uuid}.{ext} so they're unguessable.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('packet-videos', 'packet-videos', true)
on conflict (id) do nothing;

create policy "packet_videos_storage_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'packet-videos');

create policy "packet_videos_storage_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'packet-videos');

create policy "packet_videos_storage_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'packet-videos');
