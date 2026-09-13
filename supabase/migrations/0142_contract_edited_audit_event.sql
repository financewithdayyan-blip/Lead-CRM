-- Supports editing a contract's terms before anyone has signed it (see
-- update-contract-instance) — logged as its own audit event type so the
-- Audit Trail/Certificate of Completion can show a correction happened,
-- distinct from the original 'sent' event.
alter table contract_audit_events drop constraint contract_audit_events_event_type_check;
alter table contract_audit_events add constraint contract_audit_events_event_type_check
  check (event_type = any (array['viewed', 'consented', 'signed', 'sent', 'reminder_sent', 'declined', 'voided', 'expired', 'edited']));
