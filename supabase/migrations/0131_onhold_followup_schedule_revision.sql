-- Revises the On Hold follow-up schedule per the user, 2026-09-02: the
-- original day-5 checkpoint is dropped. A lead entering On Hold now gets
-- its first automated follow-up at day 10, then 20, then 30, then every 15
-- days indefinitely (no end date — matches
-- supabase/functions/send-onhold-followups/index.ts's own
-- FOLLOWUP_SCHEDULE_DAYS, updated in the same change). This migration only
-- needs to update the trigger that seeds a *brand-new* entry into On
-- Hold — leads already mid-schedule (the 27 sent their first message on
-- 2026-09-01/02) need no data fix, since their currently-stored
-- next_onhold_followup_at already lands exactly on day 10 from their real
-- send date, which this revision doesn't change.
create or replace function public.handle_onhold_followup_schedule()
returns trigger
language plpgsql
as $$
begin
  if NEW.stage = 'onhold' and (TG_OP = 'INSERT' or OLD.stage is distinct from 'onhold') then
    NEW.onhold_entered_at := now();
    NEW.onhold_followup_day := 10;
    NEW.next_onhold_followup_at := current_date + 10;
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
