-- ============================================================================
-- 0084: Bulk SMS stall watchdog
--
-- Fixes: if the browser tab running a bulk SMS send is backgrounded/killed
-- long enough, the client-side chunk loop in sendBulkSmsChunked()
-- (src/hooks/useSms.ts) simply stops firing further send-sms chunks.
-- Nothing server-side ever notices — send-sms only ever flips a job to
-- 'completed' from *inside* a chunk invocation, only when that invocation
-- observes zero items left queued/sending for it. If no invocation ever
-- runs again, the job sits at status='running' forever, with items still
-- 'queued', and no error anywhere. (The same stuck state can also happen
-- with the tab still open: sendChunkWithRetry's own timeout/settle/retry
-- budget - CLIENT_TIMEOUT_MS=150s, SETTLE_MS=60s, MAX_CHUNK_RETRIES=2 - can
-- legitimately run ~9.5 minutes before throwing, and nothing writes
-- status='failed' when that throw isn't caught by an active invocation.)
--
-- A stuck 'running' row also silently blocks
-- supabase/functions/sms-backfill/index.ts entirely (it refuses to run at
-- all while any bulk_sms_jobs row is 'running', by design, to avoid
-- competing with a live send for Zoom's rate limits).
--
-- Deliberately NOT an edge function, NOT an EdgeRuntime.waitUntil chain, and
-- adds NO new way to authenticate into send-sms. Pure SQL, scheduled via
-- pg_cron, mirroring process_auction_alerts() (0023_auction_alert_system.sql)
-- exactly: a plpgsql function that reads/writes tables directly, no HTTP
-- call of any kind, run on a timer. This sidesteps the entire failure class
-- behind the 2026-08-10 incident (a function fetching its own edge-function
-- gateway URL with a service-role Authorization: Bearer header tripped the
-- platform's own JWT-verification plumbing before the function's own
-- try/catch ever ran) because nothing here calls any URL at all.
--
-- send-sms's own request-handling and auth model are completely untouched.
-- ============================================================================

-- The watchdog's own query, and several existing hot paths
-- (useResumeBulkSmsJob, useBulkSmsJobItems, send-sms's own remaining-items
-- check at the end of Deno.serve) all filter bulk_sms_job_items by
-- (job_id, status) — only a bare (job_id) index exists today (0046).
create index if not exists bulk_sms_job_items_job_id_status_idx
  on public.bulk_sms_job_items (job_id, status);

create or replace function public.process_bulk_sms_stall_watchdog()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  -- Justified against the client's own worst-case *legitimate* silent
  -- period (see src/hooks/useSms.ts: sendChunkWithRetry). CLIENT_TIMEOUT_MS
  -- (150s) + SETTLE_MS (60s), retried MAX_CHUNK_RETRIES (2) more times,
  -- means a live tab-open run that keeps hitting FunctionsFetchError can
  -- legitimately go 150+60+150+60+150 = 570s (~9.5 min) with zero writes to
  -- bulk_sms_jobs or bulk_sms_job_items before the client itself gives up.
  -- 15 minutes gives that a healthy margin (>50% headroom) so a genuinely
  -- still-retrying send is never mistaken for a stall.
  v_stall_threshold interval := '15 minutes';
begin
  for r in
    update public.bulk_sms_jobs j
    set status = 'failed',
        error = 'This send stopped making progress for over 15 minutes '
             || '(most likely the browser tab was closed or the device went '
             || 'to sleep) and was automatically marked Failed so it would '
             || 'not sit stuck forever. Click Resume on this send to pick up '
             || 'exactly where it left off — leads already messaged are unaffected.',
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
        -- GREATEST rather than a plain "items, falling back to job only if
        -- no items exist": bulk_sms_jobs.updated_at is touched at the very
        -- start of every chunk invocation, before that chunk's own items
        -- are touched at all — an invocation genuinely alive but still
        -- stuck in Zoom-auth/user-lookup setup can have a fresher
        -- job.updated_at than any item. Falls back to j2.updated_at alone
        -- only when the job has no items at all (total=0).
        and greatest(j2.updated_at, coalesce(i.max_item_updated_at, j2.updated_at))
              < now() - v_stall_threshold
    ) stale
    where j.id = stale.id
    returning j.id, j.user_id, j.total
  loop
    -- Items left at 'sending' by a crashed/platform-killed invocation are
    -- never reset by anything else today — useResumeBulkSmsJob only
    -- re-targets status='queued'. Safe here specifically because the
    -- job-level staleness predicate above already guarantees EVERY item in
    -- this job (including any at 'sending') has gone >= v_stall_threshold
    -- with no write of any kind, and every write inside send-sms's own
    -- per-lead path completes in, at most, low tens of seconds (bounded by
    -- FETCH_TIMEOUT_MS=15s per Zoom call via AbortSignal.timeout, worst
    -- case ~82s across zoomFetch's own bounded 429-retry loop). No
    -- invocation that's actually still alive and about to finish a lead
    -- could leave that lead's row untouched for 15 minutes, and a
    -- platform-killed invocation cannot resume and write 'sent' later —
    -- there is no live process this reset could race against. Accepted
    -- trade-off (confirmed with the user): a narrow, low-probability window
    -- exists where Zoom already delivered the text right before a crash
    -- landed in the few seconds before the DB write recording it — traded
    -- against the alternative of these leads never getting a message at
    -- all from this job.
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

-- Postgres functions are EXECUTE-able by PUBLIC by default unless revoked.
-- Unlike process_auction_alerts() (0023), there is no legitimate reason for
-- any client (admin or otherwise) to ever call this directly — it isn't
-- scoped to the caller at all (it sweeps every stale job for every user)
-- and exists purely for the cron schedule below and manual SQL-editor
-- verification. Deliberately revoked rather than granted to authenticated.
revoke execute on function public.process_bulk_sms_stall_watchdog() from public;

-- Every 5 minutes — frequent enough that the 15-minute staleness threshold
-- above, not the cron cadence, is the dominant source of detection latency.
-- Guard mirrors 0023's (pg_cron is already enabled by 0065, so this is
-- belt-and-suspenders, not load-bearing).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'bulk-sms-stall-watchdog',
      '*/5 * * * *',
      'select process_bulk_sms_stall_watchdog()'
    );
  end if;
end;
$$;
