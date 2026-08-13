-- Replaces the flat, ever-growing per-lead task list (46 open and counting)
-- with aggregate daily categories on the dashboard. The two sources that
-- created one task per lead every time it qualified are retired; what an
-- admin actually needs — "how many leads need a followup right now" — is
-- computed fresh each time instead, so it self-resolves the moment real
-- activity happens on a lead rather than needing something to remember to
-- mark a task complete.

-- Clears today's 46-and-growing backlog. The underlying leads aren't lost —
-- they'll show up in get_dashboard_task_summary below based on their actual
-- current state, not a stale row from whenever they first qualified.
update public.tasks set completed = true where auto_created = true and completed = false;

-- The trigger that inserted "Follow up with X" + "Get the contract from X"
-- for every lead the moment it reached a qualified stage — replaced by the
-- summary RPC below, which answers the same question from live lead state
-- instead of a one-time snapshot task.
drop trigger if exists trg_lead_qualified_tasks on public.leads;
drop function if exists public.handle_lead_qualified_tasks();

-- Leads worth a nudge today: in a stage where the conversation should still
-- be moving, but nothing has actually happened on the lead in p_stale_days —
-- covers a stalled qualified lead, a price decline sitting in onhold, or a
-- contract sent and never chased, all in one self-resolving definition
-- (any new activity, inbound or outbound, drops the lead off this list).
create or replace function public.get_followup_leads(p_stale_days int default 2)
returns table (id uuid, first_name text, last_name text, stage text)
language sql
stable
as $$
  select l.id, l.first_name, l.last_name, l.stage
  from public.leads l
  where l.stage in ('replied', 'initial_contact', 'followup', 'negotiation', 'onhold', 'contract')
    and not exists (
      select 1 from public.lead_activities a
      where a.lead_id = l.id and a.created_at > now() - (p_stale_days || ' days')::interval
    )
  order by l.first_name;
$$;

grant execute on function public.get_followup_leads(int) to authenticated;

-- Qualified leads nobody has actually run comps/ARV on yet (no deal packet
-- built at all) — the "run the numbers" bucket.
create or replace function public.get_no_packet_leads()
returns table (id uuid, first_name text, last_name text)
language sql
stable
as $$
  select l.id, l.first_name, l.last_name
  from public.leads l
  where l.stage in ('initial_contact', 'followup', 'negotiation', 'contract')
    and not exists (select 1 from public.deal_packets dp where dp.lead_id = l.id)
  order by l.first_name;
$$;

grant execute on function public.get_no_packet_leads() to authenticated;
