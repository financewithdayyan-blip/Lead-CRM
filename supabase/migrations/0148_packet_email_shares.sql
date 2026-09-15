-- ============================================================================
-- Deal packet email-share tracking.
--
-- One row per "email this packet" send (see send-packet-email), so the
-- packet's analytics can show who it was emailed to and whether they've
-- opened the email or clicked through to the packet. Both signals are
-- server-recorded by two new public tracking edge functions keyed on
-- tracking_token, not by anything the client claims — the same posture as
-- every other public packet endpoint in this file. Writes only ever happen
-- via the service-role client inside those functions, so — like
-- push_subscriptions — there is deliberately no insert/update policy here.
-- ============================================================================

create table public.packet_email_shares (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.deal_packets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  to_email text not null,
  note text,
  -- Embedded in both the tracking-pixel <img> src and the CTA/fallback
  -- link's redirect URL for this one send, unique so either signal maps
  -- back to exactly one row.
  tracking_token text not null unique,
  created_at timestamptz not null default now(),
  email_opened_at timestamptz,
  email_open_count integer not null default 0,
  link_clicked_at timestamptz,
  link_click_count integer not null default 0
);

create index packet_email_shares_packet_id_idx on public.packet_email_shares (packet_id);
create index packet_email_shares_tracking_token_idx on public.packet_email_shares (tracking_token);

alter table public.packet_email_shares enable row level security;

-- Same owner/overseeing-admin idiom as packet_views_select.
create policy "packet_email_shares_select" on public.packet_email_shares
  for select using (
    exists (select 1 from public.deal_packets p where p.id = packet_id
            and (p.user_id = auth.uid()
                 or (public.is_team_overseer(p.user_id) and public.current_role() = 'admin')))
  );
