-- Calendar page: manually scheduled appointments (walkthroughs, signings,
-- closings, and ad-hoc calls) shown on the new /calendar page alongside
-- each lead's existing scheduled-callback/next-follow-up data (read
-- straight off `leads`, not duplicated into this table).

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  event_type text not null check (event_type in ('walkthrough', 'call', 'signing', 'closing')),
  title text not null,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calendar_events_user_id_idx on public.calendar_events (user_id);
create index calendar_events_starts_at_idx on public.calendar_events (starts_at);
create index calendar_events_lead_id_idx on public.calendar_events (lead_id);

create trigger set_calendar_events_updated_at before update on public.calendar_events
  for each row execute function public.set_updated_at();

-- Same shape as tags/leads: owner sees their own, an overseer (admin) sees
-- their whole team's merged in, everyone else only ever sees their own.
alter table public.calendar_events enable row level security;

create policy "calendar_events_select" on public.calendar_events
  for select using (user_id = auth.uid() or public.is_team_overseer(user_id));

create policy "calendar_events_insert" on public.calendar_events
  for insert with check (user_id = auth.uid());

create policy "calendar_events_update" on public.calendar_events
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "calendar_events_delete" on public.calendar_events
  for delete using (user_id = auth.uid());
