-- ============================================================================
-- Blue Docs — admin-only contract template library + LOI generator.
--
-- Step 1 scope: a template library (contract templates uploaded as blank
-- forms, grouped by deal type; the LOI template as merge-tag text) and a
-- generated_lois table for actually producing a quick LOI per lead, snapshot
-- style like deal_packets so a generated LOI's shareable link never changes
-- out from under someone even if the lead's own data changes later.
--
-- e-signing is a later step and touches nothing here yet.
-- ============================================================================

-- ── doc_templates ────────────────────────────────────────────────────────────
create table public.doc_templates (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('loi', 'contract')),
  -- Only meaningful (and required) for contracts — cash/novation/subject-to/
  -- seller-finance each have their own paperwork.
  contract_type text check (contract_type in ('cash', 'novation', 'subject_to', 'seller_finance')),
  name text not null,
  -- LOI: merge-tag text template, rendered client-side per lead.
  body text,
  -- Contract: the uploaded blank form file.
  storage_path text,
  file_name text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint doc_templates_contract_type_required
    check ((type = 'contract' and contract_type is not null) or (type = 'loi'))
);
create index doc_templates_type_idx on public.doc_templates (type);

-- ── generated_lois ──────────────────────────────────────────────────────────
-- One row per "Generate LOI" click. body is the fully rendered text at that
-- moment — snapshotted, not re-rendered later — same reasoning as deal_packets:
-- a link already shared with a seller must never change under them.
create table public.generated_lois (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  template_id uuid references public.doc_templates(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,

  slug uuid not null unique default gen_random_uuid(),
  status text not null default 'active' check (status in ('active', 'archived')),

  body text not null,
  lead_name text,
  property_address text,

  created_at timestamptz not null default now()
);
create index generated_lois_lead_id_idx on public.generated_lois (lead_id);
create index generated_lois_slug_idx    on public.generated_lois (slug);

-- ============================================================================
-- RLS — Blue Docs is an admin-only feature end to end, unlike per-owner
-- tables elsewhere in this schema. No caller ever reads these tables.
-- ============================================================================

alter table public.doc_templates   enable row level security;
alter table public.generated_lois  enable row level security;

create policy "doc_templates_all" on public.doc_templates
  for all using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

create policy "generated_lois_all" on public.generated_lois
  for all using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

-- ============================================================================
-- Public RPC — the shareable LOI link. Same shape as deal_packets' public
-- surface: anon visitors only ever reach this function, never the table
-- directly, and only an 'active' row resolves at all.
-- ============================================================================

create or replace function public.get_public_loi(p_slug uuid)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'body',            g.body,
    'leadName',        g.lead_name,
    'propertyAddress', g.property_address,
    'createdAt',       g.created_at
  )
  from public.generated_lois g
  where g.slug = p_slug and g.status = 'active';
$$;

revoke all on function public.get_public_loi(uuid) from public;
grant execute on function public.get_public_loi(uuid) to anon, authenticated;

-- ============================================================================
-- Storage — private bucket for uploaded contract template files. Downloaded
-- via signed URL, same as lead-files, but gated on admin role rather than
-- folder-matched ownership since this whole feature is admin-only.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('blue-docs', 'blue-docs', false)
on conflict (id) do nothing;

create policy "blue_docs_storage_select" on storage.objects
  for select using (bucket_id = 'blue-docs' and public.current_role() = 'admin');

create policy "blue_docs_storage_insert" on storage.objects
  for insert with check (bucket_id = 'blue-docs' and public.current_role() = 'admin');

create policy "blue_docs_storage_delete" on storage.objects
  for delete using (bucket_id = 'blue-docs' and public.current_role() = 'admin');
