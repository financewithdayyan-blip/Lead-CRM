-- ============================================================================
-- Deal packet comments — a private feedback channel from an investor viewing
-- a public packet back to the packet's owner. Visible only to the owner (or
-- an overseeing admin), never to other investors — mirrors packet_views'
-- exact shape and access pattern (viewer_token/name/email, RLS scoped to
-- owner-or-overseeing-admin, all writes through a security-definer RPC so
-- anon never gets a table-level INSERT policy).
-- ============================================================================

create table public.packet_comments (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.deal_packets(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  viewer_token text not null,
  viewer_name text,
  viewer_email text,
  body text not null,
  created_at timestamptz not null default now()
);

create index packet_comments_packet_id_idx on public.packet_comments (packet_id, created_at desc);

alter table public.packet_comments enable row level security;

-- Same owner-or-overseeing-admin pattern as packet_views_select — no anon
-- policy at all; the public side only ever reaches this table through
-- add_packet_comment below.
create policy "packet_comments_select" on public.packet_comments
  for select using (
    exists (select 1 from public.deal_packets p where p.id = packet_id
            and (p.user_id = auth.uid()
                 or (public.is_team_overseer(p.user_id) and public.current_role() = 'admin')))
  );

create or replace function public.add_packet_comment(
  p_slug uuid,
  p_body text,
  p_viewer_token text,
  p_viewer_name text default null,
  p_viewer_email text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_packet public.deal_packets%rowtype;
  v_body text;
begin
  select * into v_packet from public.deal_packets where slug = p_slug and status = 'active';
  if not found then return; end if;

  v_body := trim(p_body);
  if v_body = '' or length(v_body) > 2000 then return; end if;

  insert into public.packet_comments
    (packet_id, lead_id, viewer_token, viewer_name, viewer_email, body)
  values
    (v_packet.id, v_packet.lead_id, p_viewer_token,
     nullif(p_viewer_name, ''), nullif(p_viewer_email, ''), v_body);
end;
$$;

revoke all on function public.add_packet_comment(uuid, text, text, text, text) from public;
grant execute on function public.add_packet_comment(uuid, text, text, text, text) to anon, authenticated;
