-- ============================================================================
-- daily_stats recompute helper — derives daily_stats from call_log instead of
-- trusting any copied snapshot (legacy snapshot was localStorage-only).
-- Used by scripts/migrate-legacy-data.ts after the call_log backfill, and
-- safe to call any time to repair drift.
-- ============================================================================

create or replace function public.recompute_daily_stats_all()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.daily_stats (user_id, stat_date, calls, conversations, voicemail, dead)
  select
    user_id,
    created_at::date as stat_date,
    count(*) as calls,
    count(*) filter (where status in ('followup', 'followup2', 'followup3', 'negotiating', 'contract')) as conversations,
    count(*) filter (where status = 'voicemail') as voicemail,
    count(*) filter (where status in ('dead', 'declined')) as dead
  from public.call_log
  group by user_id, created_at::date
  on conflict (user_id, stat_date) do update set
    calls = excluded.calls,
    conversations = excluded.conversations,
    voicemail = excluded.voicemail,
    dead = excluded.dead;
$$;
