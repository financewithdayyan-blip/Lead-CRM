-- Blue Docs — per-field signing audit trail. Until now a party's signature
-- was recorded once per role (contract_signing_parties.signature_data_url),
-- so a document with multiple signature boxes for the same signer had no
-- way to tell which box was actually completed, or when — submit-signature's
-- own comment even noted "there is no finer-grained 'this exact field was
-- typed at this exact second' capture anywhere in the system." Signing now
-- happens box by box (see SignContractPage), so each signature field gets
-- its own audit_events row.
--
-- field_id is a plain text column, not a foreign key — a ContractField's id
-- is a client-generated UUID living inside doc_templates.fields / an
-- instance's template_fields_snapshot JSONB, never its own table row, so
-- there's nothing to reference.
alter table contract_audit_events add column if not exists field_id text;

alter table contract_audit_events drop constraint contract_audit_events_event_type_check;
alter table contract_audit_events add constraint contract_audit_events_event_type_check
  check (event_type = any (array['viewed', 'consented', 'signed', 'sent', 'reminder_sent', 'declined', 'voided', 'expired', 'edited', 'field_signed']));
