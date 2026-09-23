-- Two more real-time push triggers, same shape as 0144's lc_notifications ->
-- send-push-notification wiring — these just insert into lc_notifications
-- and let the existing trg_lc_notification_push trigger do the actual send,
-- rather than duplicating its vault-secret-lookup + net.http_post call.
--
-- SECURITY DEFINER on both: a Kanban drag or an inbound SMS reply is very
-- often actioned by someone other than the lead's own owner (an admin
-- dragging a teammate's lead, or sms-webhook's service-role client), and
-- lc_notifications has no INSERT policy at all — every existing insert into
-- it already goes through a security definer trigger or the service role
-- for exactly this reason (see 0057_lead_qualified_tasks_trigger.sql for
-- the same rationale applied to task creation).

-- ── Lead qualified ──────────────────────────────────────────────────────
-- Same "qualified-or-beyond, first time only" transition as
-- 0043/0057 — fires once per lead, however it gets there (AI qualification,
-- a manual Kanban drag, a call outcome).
create or replace function public.handle_lead_qualified_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  qualified_stages text[] := array['initial_contact', 'followup', 'negotiation', 'contract'];
  was_qualified boolean := TG_OP = 'UPDATE' and OLD.stage = any(qualified_stages);
  is_qualified boolean := NEW.stage = any(qualified_stages);
  display_name text := coalesce(nullif(trim(coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, '')), ''), 'A lead');
begin
  if is_qualified and not was_qualified then
    insert into public.lc_notifications (user_id, lead_id, type, title, body)
    values (
      NEW.user_id,
      NEW.id,
      'lead_qualified',
      'Lead qualified',
      display_name || coalesce(' — ' || nullif(NEW.address, ''), '')
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_lead_qualified_push on public.leads;
create trigger trg_lead_qualified_push
  after insert or update of stage on public.leads
  for each row execute function public.handle_lead_qualified_push();

-- ── Lead replied ────────────────────────────────────────────────────────
-- Mirrors sms-webhook's own "only advance forward" ADVANCE_FROM set (new /
-- voicemail / contacted -> replied) so this fires exactly once per lead, the
-- first time they text back — not on every message in an ongoing
-- conversation, and never for a lead moving through 'replied' from some
-- other stage (there isn't one — it's only ever entered from those three).
create or replace function public.handle_lead_replied_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  display_name text := coalesce(nullif(trim(coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, '')), ''), 'A lead');
begin
  if NEW.stage = 'replied' and OLD.stage in ('new', 'voicemail', 'contacted') then
    insert into public.lc_notifications (user_id, lead_id, type, title, body)
    values (
      NEW.user_id,
      NEW.id,
      'lead_replied',
      display_name || ' replied',
      'They just texted back — reply while it''s fresh.'
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_lead_replied_push on public.leads;
create trigger trg_lead_replied_push
  after update of stage on public.leads
  for each row execute function public.handle_lead_replied_push();
