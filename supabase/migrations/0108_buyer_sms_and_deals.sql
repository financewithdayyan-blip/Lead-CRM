-- ============================================================================
-- Buyer SMS threading — a self-contained, admin-only two-way text thread per
-- cash buyer. Deliberately NOT built on the lead outreach pipeline: no AI
-- auto-reply, no stage tracking, no bulk queue. Buyers get occasional manual
-- texts from an admin, not automated cold outreach, so a much smaller mirror
-- of the leads SMS system (0037/0038) is enough.
-- ============================================================================

-- Normalised phone for inbound matching — identical shape to
-- leads.phone_norm (0037_sms_phase1_sending.sql) so sms-webhook can resolve
-- an inbound text to a buyer the same way it already resolves one to a lead.
alter table public.cash_buyers
  add column phone_norm text
  generated always as (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)) stored;

create index cash_buyers_phone_norm_idx on public.cash_buyers (phone_norm);

-- Set by a STOP/decline reply, same semantics as leads.opted_out — stops all
-- future sends to this buyer.
alter table public.cash_buyers add column sms_opted_out boolean not null default false;

-- Which of the 6 shared Zoom numbers this buyer's thread lives on, pinned on
-- first send/receive so replies never fragment across numbers. Same slot
-- values as leads.assigned_sms_number (0045/0095_assigned_sms_number*.sql).
alter table public.cash_buyers add column assigned_sms_number text check (assigned_sms_number in ('1','2','3','4','5','6'));

-- Single table for both directions (unlike leads' inbound_messages +
-- lead_activities split) — buyers don't need the "activity feed" concept
-- leads have (calls, notes, stage changes), just the thread itself.
create table public.buyer_messages (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.cash_buyers(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  from_phone text,
  to_phone text,
  sent_from text,
  user_id uuid references public.profiles(id) on delete set null,
  zoom_message_id text,
  created_at timestamptz not null default now()
);

create index buyer_messages_buyer_id_idx on public.buyer_messages (buyer_id, created_at);

alter table public.buyer_messages enable row level security;

create policy "buyer_messages_select" on public.buyer_messages
  for select using (public.current_role() = 'admin');

-- No insert/update/delete policy for authenticated callers — outbound sends
-- go through the send-buyer-sms edge function and inbound through
-- sms-webhook, both service-role, same append-only-from-the-client shape as
-- send_log/inbound_messages.

-- ============================================================================
-- Deals bought — a manual log of past sales to a buyer. There is no existing
-- link anywhere in the schema between a completed deal and who bought it
-- (deal_packets.status tops out at 'archived', no buyer column ever
-- existed) — this is a plain admin-entered record, not derived from
-- anything automatic.
-- ============================================================================

create table public.buyer_deals (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.cash_buyers(id) on delete cascade,
  property_address text not null,
  city text,
  state text,
  sale_price numeric,
  closed_date date,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index buyer_deals_buyer_id_idx on public.buyer_deals (buyer_id, closed_date desc);

alter table public.buyer_deals enable row level security;

create policy "buyer_deals_all" on public.buyer_deals
  for all using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
