-- Property photo uploads on the public contact-us form.

alter table web_leads add column if not exists photo_urls text[];

-- Storage — public bucket, anon can upload (public form, no auth), size/type
-- capped at the bucket level since there's no server in the upload path to
-- validate client-side limits.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'web-lead-photos',
  'web-lead-photos',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

create policy "web_lead_photos_storage_select" on storage.objects
  for select using (bucket_id = 'web-lead-photos');

create policy "web_lead_photos_storage_insert" on storage.objects
  for insert to anon with check (bucket_id = 'web-lead-photos');
