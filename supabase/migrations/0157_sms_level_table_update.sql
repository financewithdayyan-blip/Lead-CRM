-- Another pass at the level->daily-limit table (was 250-5000, now
-- 300-3500) — mirrors SMS_DLC_LEVEL_DAILY_LIMITS in
-- src/lib/smsDlcLevels.ts exactly.
create or replace function public.sms_dlc_level_limit(p_level int)
returns int
language sql
immutable
as $$
  select case p_level
    when 1 then 300 when 2 then 500 when 3 then 700 when 4 then 1000 when 5 then 1300
    when 6 then 1600 when 7 then 2000 when 8 then 2300 when 9 then 2600 when 10 then 3000
    when 11 then 3300 when 12 then 3500
    else 0
  end;
$$;

-- Resync any account already sitting on a level to the new table's value.
update public.sms_send_settings
set daily_limit = sms_dlc_level_limit(daily_limit_level)
where daily_limit_level >= 1;
