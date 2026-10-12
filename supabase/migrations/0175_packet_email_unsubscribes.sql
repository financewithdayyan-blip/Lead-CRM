-- ============================================================================
-- Deal-packet email unsubscribe/suppression list.
--
-- The redesigned packet-share email (see send-packet-email) carries a real,
-- working "Unsubscribe" link — this is a commercial/off-market-deal email to
-- a third party, not a transactional one, so the link needs to actually do
-- something rather than just sit there. One row per suppressed address;
-- send-packet-email checks this before every send and refuses to send to a
-- suppressed address. Written only by the unsubscribe-packet-email edge
-- function (service role) — same posture as packet_email_shares itself, no
-- client insert/update/delete policy at all.
-- ============================================================================

create table public.packet_email_unsubscribes (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.packet_email_unsubscribes enable row level security;

create policy "packet_email_unsubscribes_select" on public.packet_email_unsubscribes
  for select using (public.current_role() = 'admin');
