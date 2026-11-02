-- Every MMS image already re-hosted into the private lead-files bucket by
-- sms-webhook's rehostAttachments (it writes storage_path back onto
-- inbound_messages.attachments) never got a matching lead_files row — that
-- table is what the Property tab's photo gallery actually reads, so these
-- photos were only ever viewable from inside the SMS thread, requiring a
-- manual download-then-re-upload to get them onto the lead's own gallery.
-- Going forward sms-webhook writes the lead_files row itself at re-host
-- time; this is the one-time catch-up for everything received before that
-- fix shipped. Guarded with NOT EXISTS so it's safe to re-run.
insert into public.lead_files (lead_id, user_id, storage_path, file_name, file_type)
select
  im.lead_id,
  l.user_id,
  att->>'storage_path' as storage_path,
  coalesce(att->>'name', 'attachment') as file_name,
  case lower(split_part(coalesce(att->>'name', ''), '.', -1))
    when 'jpg' then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    when 'png' then 'image/png'
    when 'gif' then 'image/gif'
    when 'webp' then 'image/webp'
    when 'heic' then 'image/heic'
  end as file_type
from public.inbound_messages im
cross join lateral jsonb_array_elements(im.attachments) as att
join public.leads l on l.id = im.lead_id
where im.lead_id is not null
  and att->>'storage_path' is not null
  and lower(split_part(coalesce(att->>'name', ''), '.', -1)) in ('jpg', 'jpeg', 'png', 'gif', 'webp', 'heic')
  and not exists (
    select 1 from public.lead_files lf
    where lf.lead_id = im.lead_id and lf.storage_path = att->>'storage_path'
  );
