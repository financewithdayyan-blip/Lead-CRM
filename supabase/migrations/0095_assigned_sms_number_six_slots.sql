-- The number pool grew from 4 to 6 (see src/lib/smsNumbers.ts SMS_NUMBER_KEYS)
-- but this check constraint was never widened, so any lead whose thread
-- actually lives on slot 5 or 6 silently failed to ever get pinned.
alter table public.leads drop constraint if exists leads_assigned_sms_number_check;
alter table public.leads
  add constraint leads_assigned_sms_number_check check (assigned_sms_number in ('1', '2', '3', '4', '5', '6'));
