-- ============================================================================
-- Blue Docs — contract audit trail. One row per meaningful event on either
-- party's side of a signing (opening their link, actually signing), captured
-- with IP + user agent where the source has it. Admin-only reads, same as
-- everywhere else in Blue Docs; writes only ever happen through the
-- security-definer RPC below or the submit-signature edge function (service
-- role), never directly from a client.
-- ============================================================================

create table public.contract_audit_events (
  id uuid primary key default gen_random_uuid(),
  contract_instance_id uuid not null references public.contract_instances(id) on delete cascade,
  party_id uuid references public.contract_signing_parties(id) on delete set null,
  event_type text not null check (event_type in ('viewed', 'signed')),
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index contract_audit_events_instance_id_idx on public.contract_audit_events (contract_instance_id, created_at);

alter table public.contract_audit_events enable row level security;

create policy "contract_audit_events_select" on public.contract_audit_events
  for select using (public.current_role() = 'admin');

-- No client-side insert policy anywhere on purpose — a plain RPC can't see a
-- caller's real IP reliably, and a client-reported one defeats the point of
-- an audit trail. Both event types (viewed, signed) are written by edge
-- functions instead (log-signing-view, submit-signature), which read the
-- real request headers server-side.
