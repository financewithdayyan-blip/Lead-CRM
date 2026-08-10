-- Lets the UI show how long a bulk send actually took (or has been running)
-- instead of just a status badge. created_at already marks the start.
alter table public.bulk_sms_jobs add column if not exists completed_at timestamptz;
