-- Richer task-summary RPCs: phone (so the dashboard can show something
-- identifying when a lead's name is blank/placeholder), and for followups
-- specifically the actual last-activity timestamp, sorted stalest-first —
-- alphabetical-by-first-name wasn't telling anyone which lead had gone
-- quietest the longest.
drop function if exists public.get_followup_leads(int);
create or replace function public.get_followup_leads(p_stale_days int default 2)
returns table (id uuid, first_name text, last_name text, phone text, stage text, last_activity_at timestamptz)
language sql
stable
as $$
  select l.id, l.first_name, l.last_name, l.phone, l.stage,
    (select max(a.created_at) from public.lead_activities a where a.lead_id = l.id)
  from public.leads l
  where l.stage in ('replied', 'initial_contact', 'followup', 'negotiation', 'onhold', 'contract')
    and not exists (
      select 1 from public.lead_activities a
      where a.lead_id = l.id and a.created_at > now() - (p_stale_days || ' days')::interval
    )
  order by (select max(a.created_at) from public.lead_activities a where a.lead_id = l.id) asc nulls first;
$$;

grant execute on function public.get_followup_leads(int) to authenticated;

drop function if exists public.get_no_packet_leads();
create or replace function public.get_no_packet_leads()
returns table (id uuid, first_name text, last_name text, phone text)
language sql
stable
as $$
  select l.id, l.first_name, l.last_name, l.phone
  from public.leads l
  where l.stage in ('initial_contact', 'followup', 'negotiation', 'contract')
    and not exists (select 1 from public.deal_packets dp where dp.lead_id = l.id)
  order by l.first_name;
$$;

grant execute on function public.get_no_packet_leads() to authenticated;
