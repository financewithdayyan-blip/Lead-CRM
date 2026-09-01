-- ── Daily SMS cap: midnight-PKT reset instead of a rolling 24h window ──────
-- sends_in_window backed each number's daily send cap with a strict rolling
-- 24 hours ("sent_at > now() - 24h"). Bulk outreach runs one evening window,
-- 7pm-6am Pakistan time, usually wrapped up by ~7:30pm — a rolling window
-- meant today's run could still be counting against yesterday's send if it
-- started even slightly earlier (7:25 yesterday still reads as "within 24h"
-- at 7:29 today), understating real remaining capacity for no real reason.
-- A calendar-day reset at Pakistan midnight matches how sending actually
-- happens (one run per PKT day) and gives the full run — 7pm to the
-- following midnight — against a cap that's fully reset at 00:00 PKT.
--
-- p_hours is kept, unused, purely so the existing callers (send-sms,
-- bulk-sms-dispatcher — both always pass 24) don't need to change.
create or replace function public.sends_in_window(p_sent_from text, p_hours int default 24)
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select count(*)
  from public.send_log
  where sent_from = p_sent_from
    and sent_at >= date_trunc('day', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi';
$$;
