-- Replaces the manual "click to unlock" (6-of-7-days volume streak) gate
-- with automatic promotion based on real deliverability/engagement quality:
-- a level auto-promotes once the account has held it for 10+ days AND
-- sustained a 60%+ delivery rate and 15%+ reply rate over that whole
-- window. Matches feedback that raw volume consistency was the wrong
-- signal — a healthy, well-received campaign should level up on its own,
-- not wait on someone remembering to click a button.

alter table public.sms_send_settings
  add column if not exists daily_limit_level_started_at timestamptz;

-- Whenever the active level actually changes (manual save or the
-- auto-promote function below), restart the clock the 10-day minimum and
-- the rate window both measure from — one place, so neither path can
-- forget to reset it.
create or replace function public.handle_sms_level_started_at()
returns trigger
language plpgsql
as $$
begin
  if NEW.daily_limit_level is distinct from OLD.daily_limit_level then
    NEW.daily_limit_level_started_at := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sms_level_started_at on public.sms_send_settings;
create trigger trg_sms_level_started_at
  before update of daily_limit_level on public.sms_send_settings
  for each row execute function public.handle_sms_level_started_at();

-- Mirrors SMS_DLC_LEVEL_DAILY_LIMITS in src/lib/smsDlcLevels.ts exactly —
-- keep both in sync if either ever changes.
create or replace function public.sms_dlc_level_limit(p_level int)
returns int
language sql
immutable
as $$
  select case p_level
    when 1 then 200 when 2 then 350 when 3 then 500 when 4 then 700 when 5 then 950
    when 6 then 1250 when 7 then 1600 when 8 then 2000 when 9 then 2450 when 10 then 3000
    else 0
  end;
$$;

-- Real deliverability/engagement since a given timestamp, buyer-conversation
-- traffic excluded — same definitions and exclusion DashboardPage's own SMS
-- campaign stats card already uses (delivered/sent, replies/delivered), so
-- this never disagrees with what the Dashboard shows for the same window.
-- Called both by auto_promote_sms_levels below and directly by the frontend
-- (as an RPC) so the UI's progress display can never drift from what
-- actually decides a promotion.
create or replace function public.sms_level_progress(p_since timestamptz)
returns table(days_elapsed int, sent bigint, delivered bigint, replies bigint, delivery_rate numeric, reply_rate numeric)
language sql
security definer
set search_path = public
stable
as $$
  with relevant as (
    select d.direction, d.delivery_status
    from sms_delivery_log d
    where d.occurred_at >= p_since
      and right(regexp_replace(coalesce(d.counterparty_number, ''), '[^0-9]', '', 'g'), 10) not in (
        select phone_norm from cash_buyers where phone_norm is not null
      )
  )
  select
    extract(day from now() - p_since)::int,
    count(*) filter (where direction = 'Out'),
    count(*) filter (where direction = 'Out' and delivery_status = 'delivered'),
    count(*) filter (where direction = 'In'),
    case when count(*) filter (where direction = 'Out') > 0
      then round(100.0 * count(*) filter (where direction = 'Out' and delivery_status = 'delivered')
        / count(*) filter (where direction = 'Out'), 1)
      else 0 end,
    case when count(*) filter (where direction = 'Out' and delivery_status = 'delivered') > 0
      then round(100.0 * count(*) filter (where direction = 'In')
        / count(*) filter (where direction = 'Out' and delivery_status = 'delivered'), 1)
      else 0 end
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
  for rec in
    select user_id, daily_limit_level, daily_limit_unlocked_level, daily_limit_level_started_at
    from sms_send_settings
    where daily_limit_level between 1 and 9
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

select cron.schedule('sms-level-auto-promote', '0 4 * * *', $$select public.auto_promote_sms_levels();$$);
