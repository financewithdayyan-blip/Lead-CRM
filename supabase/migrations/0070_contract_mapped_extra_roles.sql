-- Lets the field mapper itself define signee roles beyond buyer/seller (e.g.
-- "Witness", "Co-Buyer") and place fields for them directly on the document
-- — not just the fieldless "Additional Signer" reviewers added in 0069.
-- party_roles holds the extra roles this template defines: [{id, label}].
-- Buyer/seller stay implicit, not stored here.
alter table public.doc_templates
  add column party_roles jsonb not null default '[]'::jsonb;

-- Custom roles are now arbitrary ids (e.g. "extra_1"), not a fixed set, so
-- the old buyer/seller/other check no longer fits. Non-empty is still
-- enforced by the not-null default + application code.
alter table public.contract_signing_parties
  drop constraint contract_signing_parties_role_check;

-- get_signing_party needs the template's party_roles so the public signing
-- page can resolve a custom role id to its human label.
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
