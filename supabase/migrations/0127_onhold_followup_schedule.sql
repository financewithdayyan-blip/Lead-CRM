-- ── On Hold nurture schedule ─────────────────────────────────────────────
-- Tracks the escalating-day follow-up schedule for leads sitting in On
-- Hold (soft price decline — see ai-reply's negative_reply handling).
-- onhold_entered_at anchors the whole schedule; next_onhold_followup_at is
-- the actual due date send-onhold-followups polls against;
-- onhold_followup_day is which day-mark that date corresponds to, so the
-- function can look up the next one in sequence after a successful send.
alter table public.leads
  add column if not exists onhold_entered_at timestamptz,
  add column if not exists next_onhold_followup_at date,
  add column if not exists onhold_followup_day int;

-- Same pattern as handle_qualified_at (0043): stamp the moment stage enters
-- the state, here also seeding day 5 as the first follow-up. Clears all
-- three the moment the lead leaves On Hold, so a lead that returns to On
-- Hold later (another soft decline down the road) starts a fresh countdown
-- instead of resuming wherever the old one left off.
create or replace function public.handle_onhold_followup_schedule()
returns trigger
language plpgsql
as $$
begin
  if NEW.stage = 'onhold' and (TG_OP = 'INSERT' or OLD.stage is distinct from 'onhold') then
    NEW.onhold_entered_at := now();
    NEW.onhold_followup_day := 5;
    NEW.next_onhold_followup_at := current_date + 5;
  elsif TG_OP = 'UPDATE' and OLD.stage = 'onhold' and NEW.stage is distinct from 'onhold' then
    NEW.onhold_entered_at := null;
    NEW.next_onhold_followup_at := null;
    NEW.onhold_followup_day := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_onhold_followup_schedule on public.leads;
create trigger trg_onhold_followup_schedule
  before insert or update of stage on public.leads
  for each row execute function public.handle_onhold_followup_schedule();

-- Backfill: leads already On Hold today are anchored to today (day 0 = now),
-- not their real historical on-hold date — confirmed with the user, so this
-- doesn't fire a pile of "overdue" day-300+ messages the moment this ships.
update public.leads
set onhold_entered_at = now(), onhold_followup_day = 5, next_onhold_followup_at = current_date + 5
where stage = 'onhold';
