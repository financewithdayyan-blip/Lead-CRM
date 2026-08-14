-- Blue Docs overhaul, phase 0 — lifecycle statuses, decline/reminder tracking,
-- and phone numbers on signing parties (this system is moving to SMS-driven
-- delivery; contract_signing_parties.email has never once been populated in
-- production, so phone becomes the real contact channel instead).
--
-- Every new status/column below is purely additive — the 5 contract_instances
-- rows live today (4 'partial', 1 'signed') and their parties keep their
-- exact current status values under the widened checks; nothing here
-- reinterprets existing data.

alter table public.contract_signing_parties
  add column phone text,
  -- Same generated-column pattern as leads.phone_norm (0037) — last 10
  -- digits, so it lines up with sms-webhook's own normalizePhone() for the
  -- inbound-reply guard added in a later migration in this series.
  add column phone_norm text
    generated always as (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)) stored,
  add column declined_at timestamptz,
  add column declined_reason text,
  add column reminder_count int not null default 0,
  add column last_reminded_at timestamptz;

create index contract_signing_parties_phone_norm_idx on public.contract_signing_parties (phone_norm);

alter table public.contract_signing_parties
  drop constraint contract_signing_parties_status_check;
alter table public.contract_signing_parties
  add constraint contract_signing_parties_status_check
  check (status in ('pending', 'signed', 'declined'));

alter table public.contract_instances
  add column voided_at timestamptz,
  add column voided_by uuid references public.profiles(id),
  add column voided_reason text,
  add column template_pdf_sha256 text,
  add column final_pdf_sha256 text;

alter table public.contract_instances
  drop constraint contract_instances_status_check;
alter table public.contract_instances
  add constraint contract_instances_status_check
  check (status in ('draft', 'sent', 'partial', 'signed', 'voided', 'declined', 'expired'));

alter table public.contract_audit_events
  drop constraint contract_audit_events_event_type_check;
alter table public.contract_audit_events
  add constraint contract_audit_events_event_type_check
  check (event_type in ('viewed', 'consented', 'signed', 'sent', 'reminder_sent', 'declined', 'voided', 'expired'));
