-- Bulk Email is paused — removing everything 0171/0173 added so nothing
-- half-built or stale is left sitting in the schema while it's off the
-- product. Rebuilt properly later once cold-email sending research is
-- done; nothing here touches the SMS level system (0172) at all.

select cron.unschedule('bulk-email-level-auto-promote');

drop function if exists public.auto_promote_bulk_email_levels();
drop function if exists public.bulk_email_warmup_limit(int);
drop function if exists public.bulk_email_level_limit(int);
drop table if exists public.bulk_email_send_settings;

drop function if exists public.resume_bulk_email_job(uuid);
drop function if exists public.pause_bulk_email_job(uuid);
drop view if exists public.bulk_email_jobs_with_counts;
drop table if exists public.bulk_email_job_items;
drop table if exists public.bulk_email_jobs;

alter table public.leads drop column if exists email_opted_out;
