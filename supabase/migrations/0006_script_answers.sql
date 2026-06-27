-- Interactive call script answers (motivation, condition, timeline, price,
-- decision, photo_request, callback), keyed by step name, filled in from
-- either the lead profile or an active call session.
alter table public.leads add column script_answers jsonb not null default '{}'::jsonb;
