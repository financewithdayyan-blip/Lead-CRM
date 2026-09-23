-- Two changes:
--
-- 1. Minimum tenure (and the rolling rate/consistency window) drops from
--    10 days to 7, both for the promotion gate and for sms_level_progress's
--    reporting window.
--
-- 2. The Level 0 -> 1 bootstrap never posted a notification — only the
--    real N -> N+1 promotions did. Fixed so every level change, including
--    the very first one, pushes "Sending level increased".

drop function if exists public.sms_level_progress(timestamptz);

create function public.sms_level_progress(p_since timestamptz)
returns table(days_elapsed int, days_active int, sent bigint, delivered bigint, replies bigint, delivery_rate numeric, reply_rate numeric)
language sql
security definer
set search_path = public
stable
as $$
  with window_start as (
    select greatest(p_since, now() - interval '7 days') as ts
  ),
  relevant as (
    select d.direction, d.delivery_status, d.occurred_at
    from sms_delivery_log d
    where d.occurred_at >= (select ts from window_start)
      and right(regexp_replace(coalesce(d.counterparty_number, ''), '[^0-9]', '', 'g'), 10) not in (
        select phone_norm from cash_buyers where phone_norm is not null
      )
  )
  select
    extract(day from now() - p_since)::int as days_elapsed,
    (select count(distinct (occurred_at at time zone 'Asia/Karachi')::date) from relevant where direction = 'Out') as days_active,
    count(*) filter (where direction = 'Out') as sent,
    count(*) filter (where direction = 'Out' and delivery_status = 'delivered') as delivered,
    count(*) filter (where direction = 'In') as replies,
    case when count(*) filter (where direction = 'Out') > 0
      then round(100.0 * count(*) filter (where direction = 'Out' and delivery_status = 'delivered')
        / count(*) filter (where direction = 'Out'), 1)
      else 0 end as delivery_rate,
    case when count(*) filter (where direction = 'Out' and delivery_status = 'delivered') > 0
      then round(100.0 * count(*) filter (where direction = 'In')
        / count(*) filter (where direction = 'Out' and delivery_status = 'delivered'), 1)
      else 0 end as reply_rate
  from relevant;
$$;

revoke all on function public.sms_level_progress(timestamptz) from public;
grant execute on function public.sms_level_progress(timestamptz) to authenticated;

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
  -- 7-day/rate gate below — and now notifies too, same as a real promotion.
  with bootstrapped as (
    update sms_send_settings
    set daily_limit_level = 1,
        daily_limit = sms_dlc_level_limit(1),
        daily_limit_unlocked_level = greatest(daily_limit_unlocked_level, 1)
    where daily_limit_level = 0
    returning user_id
  )
  insert into lc_notifications (user_id, type, title, body)
  select user_id, 'sms_level_promoted', 'Sending level increased',
    'Automatically started at Level 1 — ' || sms_dlc_level_limit(1) || '/day.'
  from bootstrapped;

  for rec in
    select user_id, daily_limit_level, daily_limit_unlocked_level, daily_limit_level_started_at
    from sms_send_settings
    where daily_limit_level between 1 and 11
      and daily_limit_level_started_at is not null
      and now() - daily_limit_level_started_at >= interval '7 days'
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
          round(p.delivery_rate, 0) || '% delivery and ' || round(p.reply_rate, 0) || '% reply rate over the last 7+ days.'
      );
    end if;
  end loop;
end;
$$;
