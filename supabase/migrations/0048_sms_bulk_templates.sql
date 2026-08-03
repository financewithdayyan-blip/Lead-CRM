-- ============================================================================
-- Saved bulk-SMS templates per tag — mirrors ai_reply_config's own shape
-- (one row per admin+tag, plus one Default row with tag_id null) so a bulk
-- send can be composed by picking a tag and previewing its saved message
-- instead of retyping a template from scratch every time.
-- ============================================================================

create table public.sms_bulk_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tag_id uuid references public.tags(id) on delete cascade,
  body text not null default '',
  updated_at timestamptz not null default now(),
  unique (user_id, tag_id)
);
create index sms_bulk_templates_user_id_idx on public.sms_bulk_templates (user_id);

-- Same NULL-is-never-equal-to-NULL reasoning as ai_reply_config: a partial
-- unique index is what actually enforces "one Default row per admin".
create unique index sms_bulk_templates_default_unique
  on public.sms_bulk_templates (user_id)
  where tag_id is null;

alter table public.sms_bulk_templates enable row level security;

create policy "sms_bulk_templates_all" on public.sms_bulk_templates
  for all using (public.current_role() = 'admin' and user_id = auth.uid())
  with check (public.current_role() = 'admin' and user_id = auth.uid());
