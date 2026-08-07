-- One-time backfill: the qualified-tasks trigger (0057) only fires on a
-- stage transition, so every lead that was ALREADY sitting in a
-- qualified-plus stage before that trigger existed never got its tasks.
-- Same logic as the trigger, applied once across current data, skipping any
-- lead that already has one (in case a very recent transition already ran
-- through the trigger).
insert into public.tasks (user_id, lead_id, title, due_date)
select l.user_id, l.id,
       'Run the numbers for ' || coalesce(nullif(l.first_name, ''), 'lead') || ' — ARV, repairs, and offer',
       current_date
from public.leads l
where l.stage in ('initial_contact', 'followup', 'negotiation', 'contract')
  and not exists (
    select 1 from public.tasks t where t.lead_id = l.id and t.title like 'Run the numbers for %'
  );

insert into public.tasks (user_id, lead_id, title, due_date)
select l.user_id, l.id,
       'Send LOI or Contract to ' || coalesce(nullif(l.first_name, ''), 'lead') || ' once terms are agreed',
       current_date
from public.leads l
where l.stage in ('initial_contact', 'followup', 'negotiation', 'contract')
  and not exists (
    select 1 from public.tasks t where t.lead_id = l.id and t.title like 'Send LOI or Contract to %'
  );
