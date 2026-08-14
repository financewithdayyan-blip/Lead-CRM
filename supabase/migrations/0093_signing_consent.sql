-- Blue Docs overhaul, phase 2 — ESIGN Act/UETA consumer consent. A signer
-- has to affirmatively agree to sign electronically before the signing UI
-- itself appears; get_signing_party now reports whether that's already
-- happened (record-consent, the only thing that ever writes a 'consented'
-- audit event) so SignContractPage knows whether to show the consent screen
-- or go straight to the document.
create or replace function public.get_signing_party(p_token uuid)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'role',        party.role,
    'name',        party.name,
    'status',      party.status,
    'signOrder',   party.sign_order,
    'isTurn', not exists (
      select 1 from public.contract_signing_parties p2
      where p2.contract_instance_id = party.contract_instance_id
        and p2.sign_order < party.sign_order
        and p2.status <> 'signed'
    ),
    'waitingOn', (
      select p2.name from public.contract_signing_parties p2
      where p2.contract_instance_id = party.contract_instance_id
        and p2.sign_order < party.sign_order
        and p2.status <> 'signed'
      order by p2.sign_order asc
      limit 1
    ),
    'contractName',  ci.name,
    'fieldValues',   ci.field_values,
    'contractStatus', ci.status,
    'blocked', case when ci.status in ('voided', 'declined') then ci.status else null end,
    'hasConsented', exists (
      select 1 from public.contract_audit_events e
      where e.party_id = party.id and e.event_type = 'consented'
    ),
    'templateStoragePath', ci.template_storage_path_snapshot,
    'templateFields', ci.template_fields_snapshot,
    'templateType', t.type,
    'templatePartyRoles', ci.template_party_roles_snapshot,
    'otherSignatures', coalesce((
      select json_agg(json_build_object('role', p3.role, 'signatureDataUrl', p3.signature_data_url))
      from public.contract_signing_parties p3
      where p3.contract_instance_id = party.contract_instance_id
        and p3.id <> party.id
        and p3.status = 'signed'
    ), '[]'::json)
  )
  from public.contract_signing_parties party
  join public.contract_instances ci on ci.id = party.contract_instance_id
  join public.doc_templates t on t.id = ci.template_id
  where party.access_token = p_token;
$$;
