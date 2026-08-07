-- Replaces the single "one limit applies to every number" column with a
-- per-number map, keyed '1'-'4' matching send-sms's own NUMBERS keys — a
-- number that isn't configured for a given account just never has its key
-- read. Missing/zero for a key means unlimited for that number, same as the
-- old single value's semantics.
alter table public.sms_send_settings add column daily_limits jsonb not null default '{}'::jsonb;

update public.sms_send_settings
set daily_limits = jsonb_build_object('1', daily_limit_per_number, '2', daily_limit_per_number, '3', daily_limit_per_number, '4', daily_limit_per_number)
where daily_limit_per_number > 0;

alter table public.sms_send_settings drop column daily_limit_per_number;
