-- Public, read-only verification data for a completed contract — the target
-- of the QR code printed on the (now condensed) Certificate of Completion.
-- Same posture as get_signing_party (0050): security definer so an
-- unauthenticated holder of the instance id can read it without an RLS
-- grant on the underlying tables, scoped to only what a verification page
-- should ever show. Gated to status = 'signed' — there's nothing to verify
-- before a document is actually complete, and this avoids exposing an
-- in-flight contract's audit trail to anyone who stumbles on its id early.
create or replace function public.get_contract_verification(p_instance_id uuid)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'name', ci.name,
    'status', ci.status,
    'completedAt', ci.completed_at,
    'propertyAddress', ci.property_address,
    'templateType', dt.type,
    'templatePartyRolesSnapshot', ci.template_party_roles_snapshot,
    'templateFieldsSnapshot', ci.template_fields_snapshot,
    'startingDocHash', ci.template_pdf_sha256,
    'finalDocHash', ci.final_pdf_sha256,
    'parties', (
      select coalesce(json_agg(json_build_object(
        'id', p.id,
        'role', p.role,
        'name', p.name,
        'status', p.status,
        'signedAt', p.signed_at,
        'signOrder', p.sign_order,
        'delegatedFromName', p.delegated_from_name,
        'delegatedAt', p.delegated_at
      ) order by p.sign_order), '[]'::json)
      from public.contract_signing_parties p
      where p.contract_instance_id = ci.id
    ),
    'events', (
      select coalesce(json_agg(json_build_object(
        'id', e.id,
        'partyId', e.party_id,
        'eventType', e.event_type,
        'ipAddress', e.ip_address,
        'userAgent', e.user_agent,
        'createdAt', e.created_at,
        'fieldId', e.field_id,
        'detail', e.detail
      ) order by e.created_at), '[]'::json)
      from public.contract_audit_events e
      where e.contract_instance_id = ci.id
    )
  )
  from public.contract_instances ci
  left join public.doc_templates dt on dt.id = ci.template_id
  where ci.id = p_instance_id
    and ci.status = 'signed';
$$;

grant execute on function public.get_contract_verification(uuid) to anon, authenticated;
