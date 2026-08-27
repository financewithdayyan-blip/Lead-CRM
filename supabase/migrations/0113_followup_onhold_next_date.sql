-- On Hold leads get touched on a weekly cadence, not the 2-day staleness
-- rule active-stage leads use — that rule was surfacing nearly every
-- on-hold lead nearly every day, flooding "Do Followups" with leads nobody
-- was actually due to contact yet. Now they only show up once someone has
-- actually set a Next Follow-Up date on them (the date field on the lead's
-- Overview tab) and it's come due — matching an explicitly scheduled
-- followup instead of a blanket inactivity timer.
drop function if exists public.get_followup_leads(int);
create or replace function public.get_followup_leads(p_stale_days int default 2)
returns table (id uuid, first_name text, last_name text, phone text, stage text, last_activity_at timestamptz)
language sql
stable
as $$
  select l.id, l.first_name, l.last_name, l.phone, l.stage,
    (select max(a.created_at) from public.lead_activities a where a.lead_id = l.id)
  from public.leads l
  where (
    (l.stage in ('replied', 'initial_contact', 'followup', 'negotiation', 'contract')
      and not exists (
        select 1 from public.lead_activities a
        where a.lead_id = l.id and a.created_at > now() - (p_stale_days || ' days')::interval
      ))
    or
    (l.stage = 'onhold' and l.next_follow_up is not null and l.next_follow_up <= current_date)
  )
  order by (select max(a.created_at) from public.lead_activities a where a.lead_id = l.id) asc nulls first;
$$;

grant execute on function public.get_followup_leads(int) to authenticated;
