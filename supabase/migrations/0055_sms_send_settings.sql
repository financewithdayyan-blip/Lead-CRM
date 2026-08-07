-- Persists the bulk-SMS sending defaults (rolling daily limit per number,
-- delay between messages) that BulkSmsModal used to just hardcode fresh
-- every time ("150", no delay at all), so an admin sets them once instead
-- of retyping/forgetting them on every send.
create table public.sms_send_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  daily_limit_per_number int not null default 150,
  per_message_delay_ms int not null default 400,
  updated_at timestamptz not null default now()
);

alter table public.sms_send_settings enable row level security;

create policy "sms_send_settings_all" on public.sms_send_settings
  for all using (public.current_role() = 'admin' and user_id = auth.uid())
  with check (public.current_role() = 'admin' and user_id = auth.uid());
