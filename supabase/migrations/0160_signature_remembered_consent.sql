-- Signing now defaults to showing the "pick your name and style" popup on
-- EVERY signature box, not just the first — stronger evidence of deliberate
-- per-field intent than silently reusing whatever was typed on an earlier
-- box. A signer can explicitly opt out of that by checking "Remember my
-- signature for the rest of this document" in the popup, which skips the
-- popup for every box after that — but since this is a real step down in
-- per-field deliberateness, the choice to opt in gets its own audit event
-- rather than disappearing into the general 'field_signed' noise.
alter table contract_audit_events drop constraint contract_audit_events_event_type_check;
alter table contract_audit_events add constraint contract_audit_events_event_type_check
  check (event_type = any (array['viewed', 'consented', 'signed', 'sent', 'reminder_sent', 'declined', 'voided', 'expired', 'edited', 'field_signed', 'signature_remembered']));
