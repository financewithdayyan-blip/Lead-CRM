-- One-time backfill matching the same check ai-reply now runs on every
-- message going forward: a lead in Replied or Qualified who was asked for
-- photos (an outbound SMS mentioning photo/picture) but never sent one,
-- with no open "photo" task already covering it.
insert into public.tasks (user_id, lead_id, title, due_date, auto_created)
select l.user_id, l.id,
       'Get photos from ' || coalesce(nullif(trim(l.first_name), ''), 'lead') || ' — asked but not received yet',
       current_date,
       true
from public.leads l
where l.stage in ('replied', 'initial_contact')
  and exists (
    select 1 from public.lead_activities a
    where a.lead_id = l.id and a.type = 'sms' and a.meta->>'direction' = 'outbound'
      and (a.body ilike '%photo%' or a.body ilike '%pictur%')
  )
  and not exists (
    select 1 from public.inbound_messages m where m.lead_id = l.id and m.has_attachments = true
  )
  and not exists (
    select 1 from public.tasks t where t.lead_id = l.id and t.completed = false and t.title ilike '%photo%'
  );
