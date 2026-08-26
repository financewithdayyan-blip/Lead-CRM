-- ============================================================================
-- SMS delivery/reply performance tracking — mirrors what Zoom's own SMS
-- report dashboard shows (sent/delivered/reply counts, delivery rate, reply
-- rate) inside the CRM. Zoom's public API has no aggregate "campaign report"
-- endpoint we can call (confirmed: /v2/phone/reports/sms_charges requires a
-- scope this app doesn't have), but GET /v2/phone/sms/sessions/{sessionId}
-- already returns each message's real delivery_status with the scopes we
-- already have — so a periodic sync job pulls that per-message data in and
-- this table is what the dashboard chart reads from.
--
-- Rows are per Zoom message, upserted by message_id so a re-sync of the same
-- window never double-counts. Admin-only read, same posture as send_log —
-- this is account-wide performance data, not a single lead's record.
-- ============================================================================

create table public.sms_delivery_log (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,
  session_id text not null,
  direction text not null check (direction in ('Out', 'In')),
  delivery_status text,
  occurred_at timestamptz not null,
  synced_at timestamptz not null default now()
);

create index sms_delivery_log_occurred_at_idx on public.sms_delivery_log (occurred_at);

alter table public.sms_delivery_log enable row level security;

create policy "sms_delivery_log_select" on public.sms_delivery_log
  for select using (public.current_role() = 'admin');

-- No insert/update/delete policy — only the service-role sync function
-- (sync-sms-delivery-stats) ever writes here, same append-only posture as
-- send_log.
