-- Real browser push notifications — per-device subscription storage.
-- No direct INSERT/UPDATE grant to authenticated: subscribing/re-subscribing
-- goes through upsert_push_subscription() below instead, which hardcodes
-- user_id from the caller's own session rather than trusting a client-
-- supplied value, and safely reassigns an endpoint's ownership on device
-- handoff (rep A subscribes, logs out, rep B logs in on the same browser) —
-- a plain RLS UPDATE policy checking the *existing* row's user_id would
-- block that handoff outright.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

create policy "push_subscriptions_select" on push_subscriptions
  for select using (user_id = (select auth.uid()));

create policy "push_subscriptions_delete" on push_subscriptions
  for delete using (user_id = (select auth.uid()));

create or replace function public.upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values ((select auth.uid()), p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent;
end;
$$;

grant execute on function public.upsert_push_subscription(text, text, text, text) to authenticated;
