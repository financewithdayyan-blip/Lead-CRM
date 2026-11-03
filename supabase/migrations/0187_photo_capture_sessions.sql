-- Guided seller photo capture: instead of asking a seller to text photos
-- one at a time, an agent generates a one-time link. The public capture
-- page (CapturePage, /capture/:token) walks the seller through a fixed
-- shot list using the device's live camera only (getUserMedia — never a
-- file picker), uploading each photo as they go via the submit-capture-photo
-- edge function (service role — the seller's browser has no DB access of
-- its own). This table is the session the token resolves to; the photos
-- themselves land straight in the existing lead_files table/lead-files
-- bucket, same place MMS and manually-uploaded photos already live, so
-- they show up in the Property tab gallery with zero extra plumbing.
create table public.photo_capture_sessions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  photos_count int not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index photo_capture_sessions_lead_id_idx on public.photo_capture_sessions (lead_id);
create index photo_capture_sessions_token_idx on public.photo_capture_sessions (token);

alter table public.photo_capture_sessions enable row level security;

-- Same visibility rule as lead_files/lead_comps: owner or an overseeing
-- admin can see a lead's sessions (e.g. to re-copy the link); only the
-- owner creates one, matching lead_files_write's own owner-only insert.
create policy "photo_capture_sessions_select" on public.photo_capture_sessions
  for select using (
    exists (select 1 from public.leads l where l.id = lead_id and (l.user_id = auth.uid() or public.is_team_overseer(l.user_id)))
  );
create policy "photo_capture_sessions_insert" on public.photo_capture_sessions
  for insert with check (
    exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())
  );

-- Public, token-scoped read for the seller's own (unauthenticated) browser —
-- only what's needed to greet them and confirm the right address, nothing
-- else about the lead or the account.
create or replace function public.get_capture_session(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_session public.photo_capture_sessions%rowtype;
  v_lead public.leads%rowtype;
begin
  select * into v_session from public.photo_capture_sessions where token = p_token;
  if not found then return null; end if;
  select * into v_lead from public.leads where id = v_session.lead_id;

  return json_build_object(
    'status', v_session.status,
    'photosCount', v_session.photos_count,
    'firstName', v_lead.first_name,
    'address', v_lead.address,
    'city', v_lead.city,
    'state', v_lead.state
  );
end;
$$;

grant execute on function public.get_capture_session(uuid) to anon, authenticated;
