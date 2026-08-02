-- Global auto-reply on/off toggle, needed now because the ai-reply function
-- has to check it on every run even though its editor UI is a later phase.
-- One row per admin; missing row defaults to enabled in application code.
create table if not exists public.ai_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  auto_reply_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.ai_settings enable row level security;

create policy "ai_settings_all" on public.ai_settings
  for all using (public.current_role() = 'admin' and user_id = auth.uid())
  with check (public.current_role() = 'admin' and user_id = auth.uid());

-- No public RPC: the ai-reply function reads this with the service role,
-- which bypasses RLS entirely, and the admin's own toggle UI (Phase 6) is
-- covered by the ALL policy above.
