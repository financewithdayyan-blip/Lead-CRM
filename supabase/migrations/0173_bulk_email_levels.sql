-- Bulk Email's own sending-volume ramp, mirroring the SMS level system
-- (sms_send_settings / sms_dlc_level_limit / auto_promote_sms_levels) —
-- same 12-level ladder and daily-limit values, fully automatic, no manual
-- editing UI. Two differences from SMS:
--
-- 1. A fixed 5-day warm-up BEFORE Level 1 even starts: day 1 = 20/day,
--    day 2 = 40, day 3 = 80, day 4 = 80 (held), day 5 = 150, then Level 1
--    begins on day 6. SMS has no equivalent — a 10DLC number's carrier
--    trust score already gates it from outside; a brand-new sending
--    domain/IP has no such external gate, so this warms it up by hand
--    before the normal ladder takes over.
--
-- 2. Levels 1-12 promote on elapsed time alone (5+ days at the current
--    level) — no delivery-rate/reply-rate quality gate like SMS has. There
--    is no bulk-email equivalent of sms_delivery_log yet (opens/bounces/
--    replies aren't tracked anywhere — the sending dispatcher itself
--    doesn't exist yet either, see 0171's own comment), so there is
--    nothing to gate a quality check against. A rate-based gate can be
--    added here later the same way auto_promote_sms_levels has one, once
--    that tracking exists.

create table public.bulk_email_send_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  daily_limit int not null default 0,
  -- 0 = still in the pre-Level-1 warm-up (or never started). 1-12 once
  -- warm-up finishes — see bulk_email_level_limit.
  daily_limit_level int not null default 0,
  daily_limit_unlocked_level int not null default 0,
  daily_limit_level_started_at timestamptz,
  -- When warm-up began — separate from daily_limit_level_started_at, which
  -- only starts once Level 1 does. Needed to compute "day N of warm-up".
  warmup_started_at timestamptz,
  per_message_delay_ms int not null default 1000,
  updated_at timestamptz not null default now()
);

alter table public.bulk_email_send_settings enable row level security;

create policy "bulk_email_send_settings_all" on public.bulk_email_send_settings
  for all using (public.current_role() = 'admin' and user_id = auth.uid())
  with check (public.current_role() = 'admin' and user_id = auth.uid());

create or replace function public.bulk_email_level_limit(p_level int)
returns int
language sql
immutable
as $$
  -- Same ladder as sms_dlc_level_limit (0157) — "the same levels of bulk
  -- SMS" by explicit request, not a separately-invented one.
  select case p_level
    when 1 then 300 when 2 then 500 when 3 then 700 when 4 then 1000 when 5 then 1300
    when 6 then 1600 when 7 then 2000 when 8 then 2300 when 9 then 2600 when 10 then 3000
    when 11 then 3300 when 12 then 3500
    else 0
  end;
$$;

create or replace function public.bulk_email_warmup_limit(p_day int)
returns int
language sql
immutable
as $$
  -- null means "warm-up is over" — day 6+ promotes straight to Level 1.
  select case p_day
    when 1 then 20
    when 2 then 40
    when 3 then 80
    when 4 then 80
    when 5 then 150
    else null
  end;
$$;

create or replace function public.auto_promote_bulk_email_levels()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  new_level int;
  days_since_warmup int;
  warmup_limit int;
begin
  -- Bootstrap: any admin who has ever started a bulk email send but has no
  -- settings row yet begins warm-up today, at day 1's limit.
  insert into bulk_email_send_settings (user_id, daily_limit, daily_limit_level, warmup_started_at)
  select distinct j.user_id, bulk_email_warmup_limit(1), 0, now()
  from bulk_email_jobs j
  left join bulk_email_send_settings s on s.user_id = j.user_id
  where s.user_id is null;

  -- Warm-up: recompute today's limit for anyone still in it, or promote to
  -- Level 1 once day 5 has passed.
  for rec in
    select user_id, warmup_started_at
    from bulk_email_send_settings
    where daily_limit_level = 0 and warmup_started_at is not null
  loop
    days_since_warmup := floor(extract(epoch from (now() - rec.warmup_started_at)) / 86400)::int + 1;
    warmup_limit := bulk_email_warmup_limit(days_since_warmup);

    if warmup_limit is null then
      update bulk_email_send_settings
      set daily_limit_level = 1,
          daily_limit = bulk_email_level_limit(1),
          daily_limit_unlocked_level = greatest(daily_limit_unlocked_level, 1),
          daily_limit_level_started_at = now()
      where user_id = rec.user_id;

      insert into lc_notifications (user_id, type, title, body)
      values (
        rec.user_id, 'bulk_email_level_promoted', 'Bulk email sending level increased',
        'Warm-up complete — now at Level 1, ' || bulk_email_level_limit(1) || '/day.'
      );
    elsif warmup_limit is distinct from (select daily_limit from bulk_email_send_settings where user_id = rec.user_id) then
      update bulk_email_send_settings set daily_limit = warmup_limit, updated_at = now() where user_id = rec.user_id;
    end if;
  end loop;

  -- Levels 1-11 -> next, after 5+ days at the current level. Time-only —
  -- see this migration's own header comment for why there's no rate gate
  -- yet, unlike SMS.
  for rec in
    select user_id, daily_limit_level, daily_limit_unlocked_level
    from bulk_email_send_settings
    where daily_limit_level between 1 and 11
      and daily_limit_level_started_at is not null
      and now() - daily_limit_level_started_at >= interval '5 days'
  loop
    new_level := rec.daily_limit_level + 1;
    update bulk_email_send_settings
    set daily_limit_level = new_level,
        daily_limit = bulk_email_level_limit(new_level),
        daily_limit_unlocked_level = greatest(daily_limit_unlocked_level, new_level),
        daily_limit_level_started_at = now()
    where user_id = rec.user_id;

    insert into lc_notifications (user_id, type, title, body)
    values (
      rec.user_id, 'bulk_email_level_promoted', 'Bulk email sending level increased',
      'Automatically promoted to Level ' || new_level || ' — ' || bulk_email_level_limit(new_level) || '/day.'
    );
  end loop;
end;
$$;

select cron.schedule(
  'bulk-email-level-auto-promote',
  '0 4 * * *',
  $$select public.auto_promote_bulk_email_levels();$$
);
