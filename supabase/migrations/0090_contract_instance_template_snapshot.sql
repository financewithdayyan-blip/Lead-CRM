-- Blue Docs overhaul, phase 4 — fixes a real correctness bug: get_signing_party
-- and submit-signature both read a contract's field layout via a *live* join
-- to doc_templates, not a snapshot. Editing a mapped template's fields today
-- (ContractFieldMapper's save mutates doc_templates.fields in place)
-- immediately changes what every in-flight contract_instance shows its
-- remaining signers and what submit-signature stamps onto the final PDF —
-- including for parties who already signed under the old layout.
--
-- Fix: snapshot the fields/roles/file paths onto contract_instances itself
-- at send time, and read from there instead of the live template row. The
-- one-time backfill below protects the contracts already in flight today.
alter table public.contract_instances
  add column template_fields_snapshot jsonb,
  add column template_party_roles_snapshot jsonb,
  add column template_storage_path_snapshot text,
  add column template_docx_storage_path_snapshot text;

update public.contract_instances ci
set template_fields_snapshot = t.fields,
    template_party_roles_snapshot = t.party_roles,
    template_storage_path_snapshot = t.storage_path,
    template_docx_storage_path_snapshot = t.docx_storage_path
from public.doc_templates t
where t.id = ci.template_id
  and ci.template_fields_snapshot is null;

-- get_signing_party now reads the snapshot instead of joining doc_templates
-- for fields/party_roles/storage_path. The doc_templates join stays only for
-- type/name, which don't need versioning — a template's identity, not its
-- field layout.
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
