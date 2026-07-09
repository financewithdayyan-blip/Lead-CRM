-- The handle_followup_start trigger previously reset touch_count = 0 and
-- touch_dates = '{}' for ANY transition into the followup stage, including
-- from initial_contact / voicemail / onhold.  The call session now counts
-- touches for every lead called in the follow-up session (not just leads
-- already in followup stage), so those client-sent touch counts were being
-- silently overwritten by this trigger, leaving the counter stuck at 0.
--
-- New behaviour:
--   new → followup          : full reset (fresh 10-touch cycle from cold pool)
--   other stage → followup  : only set followup_start_date; preserve the
--                              touch_count / touch_dates the client sent so
--                              the transitioning call counts as a touch.

CREATE OR REPLACE FUNCTION public.handle_followup_start()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Lead created directly in followup stage
  IF TG_OP = 'INSERT' AND NEW.stage = 'followup' AND NEW.followup_start_date IS NULL THEN
    NEW.followup_start_date := CURRENT_DATE;
  END IF;

  -- Lead transitioning into followup from another stage
  IF TG_OP = 'UPDATE' AND NEW.stage = 'followup' AND OLD.stage <> 'followup' THEN
    NEW.followup_start_date := CURRENT_DATE;
    IF OLD.stage = 'new' THEN
      -- Coming straight from the cold pool: start a clean 10-touch cycle.
      NEW.touch_count         := 0;
      NEW.touch_dates         := '{}';
      NEW.early_exit_override := FALSE;
    END IF;
    -- For initial_contact / voicemail / onhold → followup, keep the
    -- touch_count and touch_dates the client already incremented so the
    -- transitioning follow-up call is not silently discarded.
  END IF;

  RETURN NEW;
END;
$$;
