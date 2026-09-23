-- sms_level_progress previously measured cumulative rates since the level
-- started, which could span months once an account got stuck (rates
-- dragged down by a rough first week that's no longer representative) and
-- gave no visibility into how *consistently* the account was actually
-- sending. Switches the rate/activity window to the last 10 calendar days
-- (or since the level started, whichever is more recent — so a level only
-- a few days old still shows honest data instead of padding with zeros),
-- and adds days_active: how many of those days had at least one real send,
-- shown on the level card as a "consistent sending" stat.
--
-- Dropped and recreated rather than CREATE OR REPLACE — Postgres refuses
-- to change an existing function's return type (the new days_active
-- column) any other way.
drop function if exists public.sms_level_progress(timestamptz);

create function public.sms_level_progress(p_since timestamptz)
returns table(days_elapsed int, days_active int, sent bigint, delivered bigint, replies bigint, delivery_rate numeric, reply_rate numeric)
language sql
security definer
set search_path = public
stable
as $$
  with window_start as (
    select greatest(p_since, now() - interval '10 days') as ts
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
