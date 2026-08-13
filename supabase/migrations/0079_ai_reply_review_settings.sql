-- Lets an admin turn the nightly ai-reply-review self-review job off (and
-- back on) from Settings, rather than needing a code deploy or manually
-- touching the pg_cron schedule. Added after the review job's Opus 5 usage
-- (roughly $0.40-0.80 a night) became visible on a day it wasn't needed.
create table public.ai_reply_review_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.ai_reply_review_settings enable row level security;

create policy "ai_reply_review_settings_all" on public.ai_reply_review_settings
  for all using (public.current_role() = 'admin' and user_id = auth.uid())
  with check (public.current_role() = 'admin' and user_id = auth.uid());
