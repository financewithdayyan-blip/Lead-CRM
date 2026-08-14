-- Updates process_bulk_sms_stall_watchdog() (0084) for the new
-- dispatcher-driven architecture (0085-0086). Two corrections, both
-- necessary for correctness now, not just improvements:
--
-- 1. Window guard. bulk-sms-dispatcher deliberately writes nothing while
--    outside the 14:00-01:00 UTC sending window (it just no-ops and waits
--    for the window to reopen) — a perfectly healthy multi-hour-old job
--    sitting through an overnight closure would otherwise look identical to
--    a genuinely stalled one. Only ever flag while the watchdog's own
--    execution falls inside the window, matching send-sms/the dispatcher's
--    own withinSendWindow() check exactly.
--
--    Residual, accepted edge case: a job whose last write was right before
--    the window closed could theoretically get evaluated in the first
--    minute or two after the window reopens, before the dispatcher's own
--    next tick (up to ~60s lag) has had a chance to refresh it — a narrow,
--    self-correcting false positive (worst case: one unnecessary Resume
--    click), not a sending-safety issue. No lead is ever affected by it —
--    a wrongly-flagged job's items simply sit at 'queued', exactly where
--    they'd already be, until Resume or the next real send.
--
-- 2. Threshold: 15 minutes -> 5 minutes. 15 minutes was calibrated against
--    the old client-side loop's worst-case legitimate silence
--    (CLIENT_TIMEOUT_MS+SETTLE_MS x retries, ~9.5 min) — that code is
--    deleted (0085-0086). The new worst case is roughly one missed
--    dispatcher tick (<=60s) plus one unusually slow 100-lead batch
--    (bounded the same way it always has been, FETCH_TIMEOUT_MS=15s per
--    Zoom call) — comfortably under 5 minutes with real margin. This is
--    now purely a backstop against the dispatcher itself failing (cron
--    disabled, secret rotated, every tick erroring), so catching that
--    faster is strictly better.
--
-- 0084's cron schedule (every 5 minutes) and its (job_id, status) index are
-- untouched — only the function body changes. CREATE OR REPLACE preserves
-- the existing REVOKE on this function; no need to repeat it.
create or replace function public.process_bulk_sms_stall_watchdog()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_stall_threshold interval := '5 minutes';
  v_in_send_window boolean;
begin
  v_in_send_window := extract(hour from (now() at time zone 'utc')) >= 14
                    or extract(hour from (now() at time zone 'utc')) < 1;
  if not v_in_send_window then
    return;
  end if;

  for r in
    update public.bulk_sms_jobs j
    set status = 'failed',
        error = 'This send stopped making progress for over 5 minutes '
             || '(most likely the automatic sender hit an unexpected error) '
             || 'and was automatically marked Failed so it would not sit '
             || 'stuck forever. Click Resume on this send to pick up exactly '
             || 'where it left off — leads already messaged are unaffected.',
        updated_at = now()
    from (
      select j2.id
      from public.bulk_sms_jobs j2
      left join (
        select job_id, max(updated_at) as max_item_updated_at
        from public.bulk_sms_job_items
        group by job_id
      ) i on i.job_id = j2.id
      where j2.status = 'running'
        and greatest(j2.updated_at, coalesce(i.max_item_updated_at, j2.updated_at))
              < now() - v_stall_threshold
    ) stale
    where j.id = stale.id
    returning j.id, j.user_id, j.total
  loop
    update public.bulk_sms_job_items
    set status = 'queued', updated_at = now()
    where job_id = r.id and status = 'sending';

    insert into public.lc_notifications (user_id, type, title, body)
    values (
      r.user_id,
      'bulk_sms_stalled',
      'Bulk SMS send stalled',
      'Your bulk SMS send (' || r.total || ' leads) stopped making progress '
      || 'and was marked Failed. Open it from Bulk SMS and click Resume to '
      || 'continue — leads already messaged are unaffected.'
    );
  end loop;
end;
$$;
