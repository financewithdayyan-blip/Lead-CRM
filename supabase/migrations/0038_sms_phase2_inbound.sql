-- ============================================================================
-- SMS outreach, phase 2: inbound webhook storage.
-- ============================================================================

-- ── webhook_log ─────────────────────────────────────────────────────────────
-- Raw audit trail of every webhook delivery, valid or not. Written before any
-- parsing is attempted, so a field-name mismatch or a bad signature still
-- leaves a record to debug from instead of vanishing silently.
create table if not exists public.webhook_log (
  id uuid primary key default gen_random_uuid(),
  event_type text,
  signature_valid boolean,
  payload jsonb not null,
  error text,
  received_at timestamptz not null default now()
);
create index if not exists webhook_log_received_at_idx on public.webhook_log (received_at desc);

alter table public.webhook_log enable row level security;
create policy "webhook_log_select" on public.webhook_log
  for select using (public.current_role() = 'admin');
-- No insert/update/delete policy: only the service-role webhook function
-- writes here, which bypasses RLS entirely.

-- ── inbound_messages ────────────────────────────────────────────────────────
create table if not exists public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  from_phone text not null,
  to_phone text not null,
  body text not null default '',
  -- Zoom retries webhook deliveries; this is what makes re-delivery a no-op
  -- instead of a duplicate row.
  zoom_message_id text unique,
  has_attachments boolean not null default false,
  attachments jsonb not null default '[]'::jsonb,
  -- Tapback-style reactions arrive on this same webhook. Flagged rather than
  -- dropped, so the raw event is still visible for debugging without it being
  -- treated as a real reply anywhere else.
  is_reaction boolean not null default false,
  received_at timestamptz not null default now(),
  -- Filled in once Phase 4 exists. Nullable now on purpose.
  drafted_reply text,
  send_error text
);

create index if not exists inbound_messages_lead_id_idx      on public.inbound_messages (lead_id, received_at desc);
create index if not exists inbound_messages_from_phone_idx   on public.inbound_messages (from_phone);
create index if not exists inbound_messages_received_at_idx  on public.inbound_messages (received_at desc);

alter table public.inbound_messages enable row level security;
create policy "inbound_messages_select" on public.inbound_messages
  for select using (public.current_role() = 'admin');
-- Writes go through the service-role webhook function only.
