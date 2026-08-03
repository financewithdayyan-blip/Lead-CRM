alter table public.leads
  add column if not exists assigned_sms_number text check (assigned_sms_number in ('1', '2', '3', '4'));
