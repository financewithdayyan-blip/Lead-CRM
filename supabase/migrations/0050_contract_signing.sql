-- ============================================================================
-- Blue Docs step 2 — contract field-mapping + sequential e-signing.
--
-- doc_templates (from 0049) gains the field-mapping columns. Two new tables
-- track a generated contract and its signing parties. Same security model as
-- deal_packets: anon signers never touch these tables directly, only the
-- get_signing_party() RPC below, and the actual signing action goes through
-- the submit-signature edge function (service role) since it also has to
-- write a signature image and, once complete, a flattened PDF to storage.
-- ============================================================================

alter table public.doc_templates
  add column fields jsonb not null default '[]'::jsonb,
  add column mapped boolean not null default false,
  add column docx_storage_path text,
  add column docx_file_name text;

-- ── contract_instances ──────────────────────────────────────────────────────
create table public.contract_instances (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.doc_templates(id) on delete set null,
  lead_id uuid not null references public.leads(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,

  name text not null,
  -- Admin-entered values for every non-signature/date field, keyed by the
  -- field's own id from doc_templates.fields.
  field_values jsonb not null default '{}'::jsonb,

  status text not null default 'partial' check (status in ('partial', 'signed')),
  final_storage_path text,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index contract_instances_lead_id_idx on public.contract_instances (lead_id);
create index contract_instances_status_idx  on public.contract_instances (status);

-- ── contract_signing_parties ────────────────────────────────────────────────
create table public.contract_signing_parties (
  id uuid primary key default gen_random_uuid(),
  contract_instance_id uuid not null references public.contract_instances(id) on delete cascade,

  role text not null check (role in ('buyer', 'seller')),
  name text not null,
  email text,

  -- The secret in this party's /sign/:token link. Deliberately separate from
  -- id, same reasoning as deal_packets.slug — unguessable, and one party's
  -- link reveals nothing about the other's.
  access_token uuid not null unique default gen_random_uuid(),
  sign_order int not null default 1,

  status text not null default 'pending' check (status in ('pending', 'signed')),
  signature_data_url text,
  signed_at timestamptz
);
create index contract_signing_parties_instance_id_idx on public.contract_signing_parties (contract_instance_id);
create index contract_signing_parties_token_idx        on public.contract_signing_parties (access_token);

-- ============================================================================
-- RLS — admin-only, same as every other Blue Docs table.
-- ============================================================================

alter table public.contract_instances       enable row level security;
alter table public.contract_signing_parties enable row level security;

create policy "contract_instances_all" on public.contract_instances
  for all using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

create policy "contract_signing_parties_all" on public.contract_signing_parties
  for all using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

-- ============================================================================
-- Public RPC — the only surface an anonymous signer ever reaches directly.
-- Actually signing goes through the submit-signature edge function instead,
-- since that also has to write to storage.
-- ============================================================================

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
    -- True once every party with a lower sign_order has already signed.
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
    -- Every other party's signature + role, so an already-filled signature
    -- shows up read-only for whoever signs next.
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

revoke all on function public.get_signing_party(uuid) from public;
grant execute on function public.get_signing_party(uuid) to anon, authenticated;
