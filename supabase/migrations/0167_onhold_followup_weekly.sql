-- Revises On Hold's follow-up cadence from day 10/20/30-then-15 to a flat
-- weekly cadence, per the user — matches send-onhold-followups/index.ts's
-- FOLLOWUP_SCHEDULE_DAYS, updated in the same change. Unlike 0131's prior
-- revision (which didn't need a data fix since the interval itself was
-- unchanged), THIS revision changes the interval, so leads already
-- mid-schedule are restarted fresh on the new weekly cadence from today —
-- avoids a burst of "overdue" sends the moment this ships.
create or replace function public.handle_onhold_followup_schedule()
returns trigger
language plpgsql
as $$
begin
  if NEW.stage = 'onhold' and (TG_OP = 'INSERT' or OLD.stage is distinct from 'onhold') then
    NEW.onhold_entered_at := now();
    NEW.onhold_followup_day := 7;
    NEW.next_onhold_followup_at := current_date + 7;
    NEW.onhold_reengaged := false;
  elsif TG_OP = 'UPDATE' and OLD.stage = 'onhold' and NEW.stage is distinct from 'onhold' then
    NEW.onhold_entered_at := null;
    NEW.next_onhold_followup_at := null;
    NEW.onhold_followup_day := null;
    NEW.onhold_reengaged := false;
  end if;
  return NEW;
end;
$$;

update public.leads
set onhold_followup_day = 7,
    next_onhold_followup_at = current_date + 7
where stage = 'onhold' and onhold_reengaged = false;
