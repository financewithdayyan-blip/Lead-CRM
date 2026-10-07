-- Automated SMS follow-up schedule for leads that go quiet mid-qualification
-- (stage 'replied' or 'initial_contact'). Anchored on last_inbound_at,
-- stamped by sms-webhook on every qualifying reply. qualify_reminder_stage
-- counts reminders sent in the CURRENT quiet streak (null = no active
-- countdown); next_qualify_reminder_at is the due timestamp
-- send-qualify-reminders polls against — same shape as
-- next_onhold_followup_at (0127), timestamptz instead of date since the
-- early reminders need hour precision.
--
-- Independent of next_reminder_at (send-reminders' own column) and
-- next_onhold_followup_at (send-onhold-followups') — three separate
-- sweeps, three separate schedules, on purpose.
alter table public.leads
  add column if not exists last_inbound_at timestamptz,
  add column if not exists qualify_reminder_stage int,
  add column if not exists next_qualify_reminder_at timestamptz;

-- Entering replied/initial_contact from outside that pair seeds a fresh
-- countdown; leaving either for any other stage clears it, so a stale
-- schedule can never fire after the lead cycles back later with irrelevant
-- old timing. Mirrors handle_onhold_followup_schedule (0127/0131) exactly.
-- Only handles ENTER/EXIT via stage change — a reply while ALREADY sitting
-- in one of these two stages (no stage change) is handled by sms-webhook's
-- own write instead (see that function's edit).
create or replace function public.handle_qualify_reminder_schedule()
returns trigger
language plpgsql
as $$
begin
  if NEW.stage in ('replied', 'initial_contact')
     and (TG_OP = 'INSERT' or OLD.stage is distinct from NEW.stage)
     and (TG_OP = 'INSERT' or OLD.stage not in ('replied', 'initial_contact')) then
    NEW.qualify_reminder_stage := 0;
    NEW.next_qualify_reminder_at := coalesce(NEW.last_inbound_at, now()) + interval '1 hour';
  elsif TG_OP = 'UPDATE' and OLD.stage in ('replied', 'initial_contact')
     and NEW.stage is distinct from OLD.stage
     and NEW.stage not in ('replied', 'initial_contact') then
    NEW.qualify_reminder_stage := null;
    NEW.next_qualify_reminder_at := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_qualify_reminder_schedule on public.leads;
create trigger trg_qualify_reminder_schedule
  before insert or update of stage on public.leads
  for each row execute function public.handle_qualify_reminder_schedule();

-- Backfill: every lead already sitting in replied/initial_contact today
-- starts a fresh 1-hour countdown from NOW, not their real historical
-- silence — mirrors 0127's own backfill choice, so this doesn't fire a pile
-- of "overdue" reminders the moment it ships.
update public.leads
set last_inbound_at = now(),
    qualify_reminder_stage = 0,
    next_qualify_reminder_at = now() + interval '1 hour'
where stage in ('replied', 'initial_contact');
