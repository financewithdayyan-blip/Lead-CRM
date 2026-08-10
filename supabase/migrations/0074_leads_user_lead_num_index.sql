-- The Leads page fetches every lead for a user in parallel 1000-row pages,
-- ordered by lead_num. With no index covering (user_id, lead_num), and one
-- user now owning nearly the entire table, Postgres falls back to a full
-- sequential scan + sort on every single page query — and firing 11 of
-- those at once (one per page) turns into real contention instead of true
-- parallelism, pushing total load time past 10 seconds.
create index if not exists leads_user_lead_num_idx on public.leads(user_id, lead_num);
