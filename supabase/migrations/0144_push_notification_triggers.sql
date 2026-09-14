-- Fires a real push notification for the events that already have a
-- genuine server-side "who gets notified" decision made:
--
-- 1. lc_notifications — AFTER INSERT ONLY, never on UPDATE/DELETE. This
--    table also has its own RLS UPDATE policy for the "mark as read" flow
--    (see 0023_auction_alert_system.sql) — firing on update too, the way
--    the blog-deploy trigger fires on insert/update/delete, would re-push
--    every time someone acknowledges a notification they've already seen.
--    Covers, with zero changes to any existing edge function/cron job:
--    auction tier/cadence/passed, bulk-sms-stalled, ai-reply-failed,
--    contract-declined, contract-sms-reply.
--
-- 2. web_leads — AFTER INSERT, fanned out to every admin. Mirrors the
--    identical "every admin" loop shape already used three separate times
--    in this codebase (0023's own auction-alert fanout, and the
--    lc_notifications inserts in decline-signature/sms-webhook) — not a
--    new pattern, just the same fan-out decision applied to a new source.
--    Website inquiries aren't in lc_notifications today, and speed-to-lead
--    on a fresh inquiry is high-value, so this is new coverage rather than
--    piggybacking on an existing insert.
--
-- Both use the same vault-secret-lookup + x-internal-secret header pattern
-- as every other trigger/cron in this repo (see 0082_blog_deploy_trigger.sql).

create or replace function public.handle_lc_notification_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_notification_trigger_secret')
    ),
    body := jsonb_build_object(
      'user_id', NEW.user_id,
      'title', NEW.title,
      'body', NEW.body,
      'url', case when NEW.lead_id is not null then '/crm/leads/' || NEW.lead_id else '/crm/notifications' end
    ),
    timeout_milliseconds := 10000
  );
  return NEW;
end;
$$;

drop trigger if exists trg_lc_notification_push on public.lc_notifications;
create trigger trg_lc_notification_push
  after insert on public.lc_notifications
  for each row execute function public.handle_lc_notification_push();

create or replace function public.handle_web_lead_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid;
  lead_name text;
begin
  lead_name := trim(coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, ''));
  if lead_name = '' then lead_name := 'Someone'; end if;

  for admin_id in select id from profiles where role = 'admin' loop
    perform net.http_post(
      url := 'https://ggfpvrdxqopippzqkojr.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_notification_trigger_secret')
      ),
      body := jsonb_build_object(
        'user_id', admin_id,
        'title', 'New website inquiry',
        'body', lead_name || coalesce(' — ' || NEW.property_address, ''),
        'url', '/crm/notifications'
      ),
      timeout_milliseconds := 10000
    );
  end loop;
  return NEW;
end;
$$;

drop trigger if exists trg_web_lead_push on public.web_leads;
create trigger trg_web_lead_push
  after insert on public.web_leads
  for each row execute function public.handle_web_lead_push();
