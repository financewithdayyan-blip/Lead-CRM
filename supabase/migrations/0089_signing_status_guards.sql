-- Blue Docs overhaul, phase 0 (cont'd) — now that contract_instances.status
-- can be 'voided'/'declined' (0088), a signer's link has to actually stop
-- working once either happens. Before this migration nothing anywhere checks
-- contract_instances.status beyond the parties' own pending/signed values —
-- get_signing_party() only ever inspected contract_signing_parties, so a
-- voided or declined instance's tokens would otherwise keep working exactly
-- as before.
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
    -- Non-null only for a terminal, no-longer-actionable instance. The
    -- signer's page renders a dedicated message for this instead of the
    -- normal signing UI once set.
    'blocked', case when ci.status in ('voided', 'declined') then ci.status else null end,
    'templateStoragePath', t.storage_path,
    'templateFields', t.fields,
    'templateType', t.type,
    'templatePartyRoles', t.party_roles,
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
