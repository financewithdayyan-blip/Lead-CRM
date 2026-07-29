-- ============================================================================
-- Deal Packets — investor-facing summaries generated from a lead.
--
-- Security model, in short: anonymous visitors NEVER touch these tables. RLS is
-- row-level, not column-level, so any anon SELECT policy on deal_packets would
-- hand out the street address in the JSON payload no matter how the UI hides it.
-- Instead the public page talks only to the security-definer RPCs at the bottom
-- of this file, which choose the columns they return. The address is served by
-- its own RPC that first checks the viewer has an approved request.
-- ============================================================================

-- ── deal_packets ────────────────────────────────────────────────────────────
create table public.deal_packets (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- Public URL token. Deliberately separate from id so the shareable link can
  -- be rotated, and so nothing about the lead is enumerable from it.
  slug uuid not null unique default gen_random_uuid(),

  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),

  -- Property summary. Snapshotted from the lead at creation rather than joined,
  -- so editing the lead later cannot silently change a packet already shared.
  owner_name  text,
  prop_type   text,
  beds        numeric,
  baths       numeric,
  sqft        integer,
  year_built  integer,
  market      text,
  lead_status text,

  -- Gated. Only ever leaves the database via get_packet_address().
  address text,
  city    text,
  state   text,
  zip     text,

  arv            numeric,
  arv_is_manual  boolean not null default false,
  assignment_fee numeric,
  show_assignment_fee boolean not null default false,

  -- Subset of: cash, subject_to, novation, creative
  deal_types text[] not null default '{}',

  narrative text,

  -- When true the public page demands name + email before rendering anything.
  require_lead_capture boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deal_packets_lead_id_idx on public.deal_packets (lead_id);
create index deal_packets_user_id_idx on public.deal_packets (user_id);
create index deal_packets_slug_idx    on public.deal_packets (slug);

-- ── packet_comps ────────────────────────────────────────────────────────────
create table public.packet_comps (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.deal_packets(id) on delete cascade,
  address    text,
  sale_price numeric,
  sale_date  date,
  sqft       integer,
  sort_order integer not null default 0
);
create index packet_comps_packet_id_idx on public.packet_comps (packet_id);

-- ── packet_repairs ──────────────────────────────────────────────────────────
create table public.packet_repairs (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.deal_packets(id) on delete cascade,
  item       text not null default '',
  cost       numeric not null default 0,
  sort_order integer not null default 0
);
create index packet_repairs_packet_id_idx on public.packet_repairs (packet_id);

-- ── packet_images ───────────────────────────────────────────────────────────
create table public.packet_images (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.deal_packets(id) on delete cascade,
  storage_path text not null,
  caption      text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index packet_images_packet_id_idx on public.packet_images (packet_id);

-- ── packet_views ────────────────────────────────────────────────────────────
-- One row per view event. viewer_token is a UUID the public page persists in
-- localStorage; it is what "unique viewer" and the address gate key off.
create table public.packet_views (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.deal_packets(id) on delete cascade,
  lead_id   uuid references public.leads(id) on delete set null,
  viewer_token text not null,
  viewer_name  text,
  viewer_email text,
  viewer_phone text,
  user_agent   text,
  created_at timestamptz not null default now()
);
create index packet_views_packet_id_idx  on public.packet_views (packet_id);
create index packet_views_created_at_idx on public.packet_views (packet_id, created_at desc);

-- ── packet_address_requests ─────────────────────────────────────────────────
create table public.packet_address_requests (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.deal_packets(id) on delete cascade,
  viewer_token text not null,
  viewer_name  text,
  viewer_email text,
  viewer_phone text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  -- One standing request per viewer per packet; re-requesting updates the row.
  unique (packet_id, viewer_token)
);
create index packet_address_requests_packet_id_idx on public.packet_address_requests (packet_id);

-- ============================================================================
-- RLS — owner + overseeing admin only. There is no anon policy anywhere here
-- by design; anonymous access goes exclusively through the RPCs below.
-- ============================================================================

alter table public.deal_packets            enable row level security;
alter table public.packet_comps            enable row level security;
alter table public.packet_repairs          enable row level security;
alter table public.packet_images           enable row level security;
alter table public.packet_views            enable row level security;
alter table public.packet_address_requests enable row level security;

create policy "deal_packets_select" on public.deal_packets
  for select using (
    user_id = auth.uid()
    or (public.is_team_overseer(user_id) and public.current_role() = 'admin')
  );

create policy "deal_packets_write" on public.deal_packets
  for all using (
    user_id = auth.uid()
    or (public.is_team_overseer(user_id) and public.current_role() = 'admin')
  ) with check (
    user_id = auth.uid()
    or (public.is_team_overseer(user_id) and public.current_role() = 'admin')
  );

-- Child tables inherit access from their parent packet.
create policy "packet_comps_all" on public.packet_comps
  for all using (
    exists (select 1 from public.deal_packets p where p.id = packet_id
            and (p.user_id = auth.uid()
                 or (public.is_team_overseer(p.user_id) and public.current_role() = 'admin')))
  );

create policy "packet_repairs_all" on public.packet_repairs
  for all using (
    exists (select 1 from public.deal_packets p where p.id = packet_id
            and (p.user_id = auth.uid()
                 or (public.is_team_overseer(p.user_id) and public.current_role() = 'admin')))
  );

create policy "packet_images_all" on public.packet_images
  for all using (
    exists (select 1 from public.deal_packets p where p.id = packet_id
            and (p.user_id = auth.uid()
                 or (public.is_team_overseer(p.user_id) and public.current_role() = 'admin')))
  );

create policy "packet_views_select" on public.packet_views
  for select using (
    exists (select 1 from public.deal_packets p where p.id = packet_id
            and (p.user_id = auth.uid()
                 or (public.is_team_overseer(p.user_id) and public.current_role() = 'admin')))
  );

create policy "packet_address_requests_all" on public.packet_address_requests
  for all using (
    exists (select 1 from public.deal_packets p where p.id = packet_id
            and (p.user_id = auth.uid()
                 or (public.is_team_overseer(p.user_id) and public.current_role() = 'admin')))
  );

-- ============================================================================
-- Public RPCs — the only surface anonymous visitors can reach.
-- ============================================================================

-- Public packet payload. Note the explicit column list: address, city and zip
-- are absent on purpose. Only 'active' packets resolve at all, so flipping a
-- packet back to draft or archived kills the shared link immediately.
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
    -- Coarse location is safe to show; it is what the packet falls back to
    -- when an address request is pending or denied.
    'state',              p.state,
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

-- City + zip are released with the address, so the packet shows only the state
-- until an admin approves. Returns null when there is no approved request.
create or replace function public.get_packet_address(p_slug uuid, p_viewer_token text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'address', p.address,
    'city',    p.city,
    'state',   p.state,
    'zip',     p.zip
  )
  from public.deal_packets p
  join public.packet_address_requests r
    on r.packet_id = p.id
   and r.viewer_token = p_viewer_token
   and r.status = 'approved'
  where p.slug = p_slug and p.status = 'active';
$$;

-- Coarse location shown before approval: city + zip, no street line.
create or replace function public.get_packet_area(p_slug uuid)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object('city', p.city, 'state', p.state, 'zip', p.zip)
  from public.deal_packets p
  where p.slug = p_slug and p.status = 'active';
$$;

create or replace function public.log_packet_view(
  p_slug uuid,
  p_viewer_token text,
  p_viewer_name text default null,
  p_viewer_email text default null,
  p_viewer_phone text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_packet public.deal_packets%rowtype;
begin
  select * into v_packet from public.deal_packets where slug = p_slug and status = 'active';
  if not found then return; end if;

  insert into public.packet_views
    (packet_id, lead_id, viewer_token, viewer_name, viewer_email, viewer_phone, user_agent)
  values
    (v_packet.id, v_packet.lead_id, p_viewer_token,
     nullif(p_viewer_name, ''), nullif(p_viewer_email, ''), nullif(p_viewer_phone, ''),
     nullif(p_user_agent, ''));
end;
$$;

-- Upsert so a viewer re-requesting does not stack duplicate rows. A previously
-- denied request returns to pending, letting an admin reconsider.
create or replace function public.request_packet_address(
  p_slug uuid,
  p_viewer_token text,
  p_viewer_name text default null,
  p_viewer_email text default null,
  p_viewer_phone text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_packet_id uuid;
  v_status text;
begin
  select id into v_packet_id from public.deal_packets where slug = p_slug and status = 'active';
  if v_packet_id is null then return 'not_found'; end if;

  insert into public.packet_address_requests
    (packet_id, viewer_token, viewer_name, viewer_email, viewer_phone)
  values
    (v_packet_id, p_viewer_token,
     nullif(p_viewer_name, ''), nullif(p_viewer_email, ''), nullif(p_viewer_phone, ''))
  on conflict (packet_id, viewer_token) do update
    set viewer_name  = coalesce(nullif(excluded.viewer_name, ''),  packet_address_requests.viewer_name),
        viewer_email = coalesce(nullif(excluded.viewer_email, ''), packet_address_requests.viewer_email),
        viewer_phone = coalesce(nullif(excluded.viewer_phone, ''), packet_address_requests.viewer_phone),
        status       = case when packet_address_requests.status = 'denied'
                            then 'pending' else packet_address_requests.status end
  returning status into v_status;

  return v_status;
end;
$$;

-- Lets the public page poll whether its own request has been approved without
-- exposing anything about other viewers.
create or replace function public.get_my_address_request(p_slug uuid, p_viewer_token text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select r.status
  from public.packet_address_requests r
  join public.deal_packets p on p.id = r.packet_id
  where p.slug = p_slug and r.viewer_token = p_viewer_token;
$$;

-- Admin-side resolution. Guarded by an explicit permission check because
-- security definer bypasses RLS.
create or replace function public.resolve_address_request(p_request_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select p.user_id into v_owner
  from public.packet_address_requests r
  join public.deal_packets p on p.id = r.packet_id
  where r.id = p_request_id;

  if v_owner is null then
    raise exception 'Address request not found';
  end if;

  if not (v_owner = auth.uid()
          or (public.is_team_overseer(v_owner) and public.current_role() = 'admin')) then
    raise exception 'Not permitted to resolve this request';
  end if;

  update public.packet_address_requests
     set status      = case when p_approve then 'approved' else 'denied' end,
         resolved_at = now(),
         resolved_by = auth.uid()
   where id = p_request_id;
end;
$$;

revoke all on function public.get_public_packet(uuid)                     from public;
revoke all on function public.get_packet_address(uuid, text)              from public;
revoke all on function public.get_packet_area(uuid)                       from public;
revoke all on function public.log_packet_view(uuid, text, text, text, text, text) from public;
revoke all on function public.request_packet_address(uuid, text, text, text, text) from public;
revoke all on function public.get_my_address_request(uuid, text)          from public;
revoke all on function public.resolve_address_request(uuid, boolean)      from public;

grant execute on function public.get_public_packet(uuid)                     to anon, authenticated;
grant execute on function public.get_packet_address(uuid, text)              to anon, authenticated;
grant execute on function public.get_packet_area(uuid)                       to anon, authenticated;
grant execute on function public.log_packet_view(uuid, text, text, text, text, text) to anon, authenticated;
grant execute on function public.request_packet_address(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.get_my_address_request(uuid, text)          to anon, authenticated;
grant execute on function public.resolve_address_request(uuid, boolean)      to authenticated;

-- ============================================================================
-- Storage — public bucket so investor images load without an auth round-trip.
-- Paths are {packet_id}/{uuid}.{ext}, so URLs are unguessable, but anyone
-- holding an exact URL keeps access even after the packet is archived.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('packet-images', 'packet-images', true)
on conflict (id) do nothing;

create policy "packet_images_storage_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'packet-images');

create policy "packet_images_storage_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'packet-images');

create policy "packet_images_storage_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'packet-images');
