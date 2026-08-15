-- Client-safe mapping of the six Zoom SMS sending slots (ZOOM_FROM_NUMBER,
-- ZOOM_FROM_NUMBER_2 .. _6 server-side) to the real phone number, so the UI
-- can show "Sending from 217-408-2781" instead of "Sending from Number 3".
-- The edge functions read the real numbers from Deno env vars; this table is
-- just an admin-filled-in label for display, not the source of truth for
-- sending — nothing here is read by any edge function.
create table if not exists public.sms_number_labels (
  slot text primary key check (slot in ('1', '2', '3', '4', '5', '6')),
  phone_number text,
  label text,
  updated_at timestamptz not null default now()
);

alter table public.sms_number_labels enable row level security;

create policy "sms_number_labels_all" on public.sms_number_labels
  for all using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

insert into public.sms_number_labels (slot) values ('1'), ('2'), ('3'), ('4'), ('5'), ('6')
on conflict (slot) do nothing;

update public.sms_number_labels set phone_number = '14693107705' where slot = '1';
update public.sms_number_labels set phone_number = '12174082781' where slot = '2';
update public.sms_number_labels set phone_number = '12393555204' where slot = '3';
update public.sms_number_labels set phone_number = '14783043440' where slot = '4';
update public.sms_number_labels set phone_number = '13463063859' where slot = '5';
update public.sms_number_labels set phone_number = '13155866349' where slot = '6';
