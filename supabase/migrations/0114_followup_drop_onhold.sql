-- The Next-Follow-Up-date rule from 0113 still resurfaced on-hold leads
-- whose date was set weeks ago and never touched since — every one of them
-- stays "due" forever once the date passes, which isn't what "selected for
-- followup" means in practice. Dropping On Hold from Do Followups
-- entirely: it's a fully automatic, always-on list, and On Hold leads
-- don't belong on it at all. A lead worth following up on goes through the
-- existing manual Tasks feature instead (Lead Profile → Tasks tab), which
-- already shows up in its own "Added by hand" section on the dashboard.
drop function if exists public.get_followup_leads(int);
create or replace function public.get_followup_leads(p_stale_days int default 2)
returns table (id uuid, first_name text, last_name text, phone text, stage text, last_activity_at timestamptz)
language sql
stable
as $$
  select l.id, l.first_name, l.last_name, l.phone, l.stage,
    (select max(a.created_at) from public.lead_activities a where a.lead_id = l.id)
  from public.leads l
  where l.stage in ('replied', 'initial_contact', 'followup', 'negotiation', 'contract')
    and not exists (
      select 1 from public.lead_activities a
      where a.lead_id = l.id and a.created_at > now() - (p_stale_days || ' days')::interval
    )
  order by (select max(a.created_at) from public.lead_activities a where a.lead_id = l.id) asc nulls first;
$$;

grant execute on function public.get_followup_leads(int) to authenticated;
