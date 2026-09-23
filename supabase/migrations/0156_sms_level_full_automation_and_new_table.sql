-- Two changes:
--
-- 1. Fully automatic now, including the very first level — there's no more
--    manual "click Level 1 to start" (the UI's Save button and level pills
--    are gone). The daily sweep now also bootstraps any account still at
--    level 0 straight to Level 1, immediately, no waiting — Level 1 has
--    never required any history to prove.
--
-- 2. New 12-level table (was 10 levels, 200-3000/day) — mirrors
--    SMS_DLC_LEVEL_DAILY_LIMITS in src/lib/smsDlcLevels.ts exactly.

create or replace function public.sms_dlc_level_limit(p_level int)
returns int
language sql
immutable
as $$
  select case p_level
    when 1 then 250 when 2 then 500 when 3 then 750 when 4 then 1000 when 5 then 1300
    when 6 then 1600 when 7 then 2000 when 8 then 2500 when 9 then 3000 when 10 then 3500
    when 11 then 4000 when 12 then 5000
    else 0
  end;
$$;

-- Resync any account already sitting on a level to the new table's value —
-- otherwise an account active on, say, the old Level 1 (200/day) would keep
-- enforcing 200/day forever despite the level table having moved on.
update public.sms_send_settings
set daily_limit = sms_dlc_level_limit(daily_limit_level)
where daily_limit_level >= 1;

create or replace function public.auto_promote_sms_levels()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  p record;
  new_level int;
begin
  -- Bootstrap: level 0 -> 1 needs no history, so it never waits on the
  -- 10-day/rate gate below.
  update sms_send_settings
  set daily_limit_level = 1,
      daily_limit = sms_dlc_level_limit(1),
      daily_limit_unlocked_level = greatest(daily_limit_unlocked_level, 1)
  where daily_limit_level = 0;

  for rec in
    select user_id, daily_limit_level, daily_limit_unlocked_level, daily_limit_level_started_at
    from sms_send_settings
    where daily_limit_level between 1 and 11
      and daily_limit_level_started_at is not null
      and now() - daily_limit_level_started_at >= interval '10 days'
  loop
    select * into p from sms_level_progress(rec.daily_limit_level_started_at);
    if p.delivery_rate >= 60 and p.reply_rate >= 15 then
      new_level := rec.daily_limit_level + 1;
      update sms_send_settings
      set daily_limit_level = new_level,
          daily_limit = sms_dlc_level_limit(new_level),
          daily_limit_unlocked_level = greatest(daily_limit_unlocked_level, new_level)
      where user_id = rec.user_id;

      insert into lc_notifications (user_id, type, title, body)
      values (
        rec.user_id,
        'sms_level_promoted',
        'Sending level increased',
        'Automatically promoted to Level ' || new_level || ' — ' || sms_dlc_level_limit(new_level) || '/day, after ' ||
          round(p.delivery_rate, 0) || '% delivery and ' || round(p.reply_rate, 0) || '% reply rate over the last 10+ days.'
      );
    end if;
  end loop;
end;
$$;
