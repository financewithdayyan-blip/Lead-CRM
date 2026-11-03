-- Backs the new admin-only Inbox page: a cross-lead conversation list sorted
-- by recency with an unread indicator. Nothing in the schema currently
-- tracks "last message time" or "unread" per lead — the existing per-lead
-- SMS tab computes a thread by querying inbound_messages + lead_activities
-- fresh every time (see useLeadThread), which is fine for one lead at a
-- time but doesn't scale to "show me every conversation at once." These
-- four columns are trigger-maintained instead, so the Inbox list is a
-- plain indexed sort rather than a live aggregation over every message in
-- the account.
alter table public.leads add column if not exists last_message_at timestamptz;
alter table public.leads add column if not exists last_message_preview text;
alter table public.leads add column if not exists last_message_direction text check (last_message_direction in ('inbound', 'outbound'));
alter table public.leads add column if not exists has_unread_sms boolean not null default false;

create index if not exists leads_last_message_at_idx on public.leads (last_message_at desc nulls last);

-- `leads` was never added to the realtime publication before this (only
-- tasks/web_leads/inbound_messages/lead_activities were, see 0059/0121/
-- 0122) — needed now so the Inbox list and its sidebar unread badge
-- actually update live instead of silently never receiving an event.
alter publication supabase_realtime add table public.leads;

-- A seller's inbound text always means "needs a look" — reactions (tapback
-- emoji, no real content) are excluded, same exclusion useLeadMessages'
-- own unansweredLeadTurns check already applies for the same reason.
create or replace function public.touch_lead_last_inbound_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_reaction or new.lead_id is null then
    return new;
  end if;
  update public.leads
  set last_message_at = new.received_at,
      last_message_preview = left(coalesce(new.body, case when new.has_attachments then '[Photo]' else '' end), 140),
      last_message_direction = 'inbound',
      has_unread_sms = true
  where id = new.lead_id;
  return new;
end;
$$;

drop trigger if exists inbound_messages_touch_lead on public.inbound_messages;
create trigger inbound_messages_touch_lead
after insert on public.inbound_messages
for each row execute function public.touch_lead_last_inbound_message();

-- An outbound text (human or AI) is, by definition, the thread having been
-- addressed — clears the unread flag the same way opening the thread in
-- the UI does.
create or replace function public.touch_lead_last_outbound_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = 'sms' and (new.meta ->> 'direction') = 'outbound' then
    update public.leads
    set last_message_at = new.created_at,
        last_message_preview = left(coalesce(new.body, ''), 140),
        last_message_direction = 'outbound',
        has_unread_sms = false
    where id = new.lead_id;
  end if;
  return new;
end;
$$;

drop trigger if exists lead_activities_touch_lead on public.lead_activities;
create trigger lead_activities_touch_lead
after insert on public.lead_activities
for each row execute function public.touch_lead_last_outbound_message();

-- One-time backfill from existing message history — the triggers above
-- only maintain this going forward, so without this every conversation
-- that existed before today would show up empty in the Inbox. A
-- conversation whose last message is genuinely inbound (seller texted,
-- nothing sent back since) is marked unread here too: that's a real,
-- already-true "needs a reply" state, not something this migration is
-- inventing.
with latest_inbound as (
  select distinct on (lead_id) lead_id, received_at as at, coalesce(body, case when has_attachments then '[Photo]' else null end) as preview
  from public.inbound_messages
  where lead_id is not null and not is_reaction
  order by lead_id, received_at desc
),
latest_outbound as (
  select distinct on (lead_id) lead_id, created_at as at, body as preview
  from public.lead_activities
  where type = 'sms' and (meta ->> 'direction') = 'outbound'
  order by lead_id, created_at desc
),
combined as (
  select
    l.id as lead_id,
    case when li.at is null or (lo.at is not null and lo.at >= li.at) then lo.at else li.at end as at,
    case when li.at is null or (lo.at is not null and lo.at >= li.at) then 'outbound' else 'inbound' end as direction,
    case when li.at is null or (lo.at is not null and lo.at >= li.at) then lo.preview else li.preview end as preview
  from public.leads l
  left join latest_inbound li on li.lead_id = l.id
  left join latest_outbound lo on lo.lead_id = l.id
  where li.lead_id is not null or lo.lead_id is not null
)
update public.leads l
set last_message_at = c.at,
    last_message_preview = left(coalesce(c.preview, ''), 140),
    last_message_direction = c.direction,
    has_unread_sms = (c.direction = 'inbound')
from combined c
where l.id = c.lead_id;
