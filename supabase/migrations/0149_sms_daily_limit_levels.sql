-- Tracks each sending number's currently-active 10DLC throughput level
-- (1-10, key absent = no cap / not on the ladder) separately from the raw
-- daily_limits number that's actually enforced by bulk-sms-dispatcher — see
-- src/lib/smsDlcLevels.ts for the level -> daily-cap table. Saving a level
-- from BulkSmsSettingsEditor still writes the mapped value into the
-- existing daily_limits column, so dispatcher enforcement is unchanged.
alter table public.sms_send_settings add column daily_limit_levels jsonb not null default '{}'::jsonb;

-- The highest level a number has ever earned, separate from the one above —
-- so temporarily dialing a number back down to a lower active level (or to
-- "No cap") never erases progress already earned toward the next unlock.
alter table public.sms_send_settings add column daily_limit_unlocked_levels jsonb not null default '{}'::jsonb;

-- ── Level-unlock eligibility ─────────────────────────────────────────────
-- Real 10DLC throughput increases require a number to actually sustain its
-- current volume, not just sit at a cap — so unlocking level N+1 requires
-- having actually sent at least level N's daily target on 6 of the last 7
-- calendar days (PKT, matching send_log's existing midnight-PKT convention).
-- One phone can be missed per week. This returns raw per-phone-per-day
-- counts for BulkSmsSettingsEditor to compare against each level's target
-- client-side (the target depends on which level is being evaluated, so
-- that comparison doesn't belong baked into SQL). Takes an array so the
-- editor can fetch every configured number's history in one round trip.
create or replace function public.sms_daily_send_counts(p_phones text[], p_days int default 7)
returns table(phone text, day date, sent_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    sent_from as phone,
    (date_trunc('day', sent_at at time zone 'Asia/Karachi'))::date as day,
    count(*) as sent_count
  from public.send_log
  where sent_from = any(p_phones)
    and sent_at >= (date_trunc('day', now() at time zone 'Asia/Karachi') - make_interval(days => p_days)) at time zone 'Asia/Karachi'
    and sent_at < date_trunc('day', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi'
  group by 1, 2
  order by 1, 2;
$$;

revoke all on function public.sms_daily_send_counts(text[], int) from public;
grant execute on function public.sms_daily_send_counts(text[], int) to authenticated;
