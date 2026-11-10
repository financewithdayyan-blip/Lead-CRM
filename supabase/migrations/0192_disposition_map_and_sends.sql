-- Disposition map/send redesign — buyer investor-strategy tagging for the
-- map's color legend (Fix & Flip / BRRRR / Buy & Hold / Wholetailer /
-- Developer), a channel marker on buyer_messages so an email send shows in
-- the same thread as SMS, and the two tables that back a bulk "send deal
-- packet to N selected buyers" action with a durable record of who got it.

alter table public.cash_buyers add column if not exists buyer_types text[] not null default '{}';

alter table public.buyer_messages add column if not exists channel text not null default 'sms' check (channel in ('sms', 'email'));

create table public.disposition_sends (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.deal_packets(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  channel text not null check (channel in ('sms', 'email', 'both')),
  message text not null,
  recipient_count int not null default 0,
  created_at timestamptz not null default now()
);

create index disposition_sends_lead_id_idx on public.disposition_sends (lead_id, created_at desc);
create index disposition_sends_packet_id_idx on public.disposition_sends (packet_id, created_at desc);

create table public.disposition_send_recipients (
  id uuid primary key default gen_random_uuid(),
  send_id uuid not null references public.disposition_sends(id) on delete cascade,
  buyer_id uuid not null references public.cash_buyers(id) on delete cascade,
  channel_used text not null check (channel_used in ('sms', 'email')),
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index disposition_send_recipients_send_id_idx on public.disposition_send_recipients (send_id);
create index disposition_send_recipients_buyer_id_idx on public.disposition_send_recipients (buyer_id, created_at desc);

alter table public.disposition_sends enable row level security;
alter table public.disposition_send_recipients enable row level security;

-- Admin-only, same posture as cash_buyers/buyer_messages themselves — this
-- whole feature is an admin/disposition tool, not something a caller role
-- ever touches.
create policy "disposition_sends_select" on public.disposition_sends
  for select using (public.current_role() = 'admin');

create policy "disposition_send_recipients_select" on public.disposition_send_recipients
  for select using (public.current_role() = 'admin');

-- No insert/update/delete policy for authenticated callers — writes only
-- happen through the send-disposition-packet edge function's service-role
-- client, same pattern as buyer_messages' own outbound rows.
