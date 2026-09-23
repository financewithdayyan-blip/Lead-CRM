-- Replaces the per-number level ladder (dailyLimits/dailyLimitLevels/
-- dailyLimitUnlockedLevels, all keyed '1'-'6') with one pooled level for
-- the whole account — feedback was that six independent ladders were
-- confusing; the business wants a single "we're at Level 5" that caps
-- total SMS per day across every number combined, not per number. The old
-- jsonb columns are left in place, unused, rather than dropped — nothing
-- reads them after this migration's app-code counterpart ships.
alter table public.sms_send_settings
  add column if not exists daily_limit int not null default 0,
  add column if not exists daily_limit_level int not null default 0,
  add column if not exists daily_limit_unlocked_level int not null default 0;
