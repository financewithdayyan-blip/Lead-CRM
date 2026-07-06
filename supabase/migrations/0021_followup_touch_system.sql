-- 10-touch follow-up system
-- Tracks contact attempts for leads in the followup stage.
-- A lead may not move to dead_declined until 10 touches are logged
-- (or an admin grants an early-exit override).

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS followup_start_date DATE,
  ADD COLUMN IF NOT EXISTS touch_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS touch_dates DATE[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS early_exit_override BOOLEAN NOT NULL DEFAULT FALSE;

-- Back-fill existing followup leads with today as the start date
UPDATE leads
SET followup_start_date = CURRENT_DATE
WHERE stage = 'followup' AND followup_start_date IS NULL;

-- ── Trigger: auto-set followup_start_date when a lead enters followup ──────
CREATE OR REPLACE FUNCTION handle_followup_start()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- New lead created directly in followup stage
  IF TG_OP = 'INSERT' AND NEW.stage = 'followup' AND NEW.followup_start_date IS NULL THEN
    NEW.followup_start_date := CURRENT_DATE;
  END IF;

  -- Existing lead transitioning into followup from another stage
  IF TG_OP = 'UPDATE' AND NEW.stage = 'followup' AND OLD.stage <> 'followup' THEN
    NEW.followup_start_date := CURRENT_DATE;
    NEW.touch_count        := 0;
    NEW.touch_dates        := '{}';
    NEW.early_exit_override := FALSE;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_followup_start
  BEFORE INSERT OR UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION handle_followup_start();

-- ── RPC: Admin override — allow early Dead/Declined without 10 touches ──────
CREATE OR REPLACE FUNCTION override_followup_early_exit(p_lead_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can override followup early exit';
  END IF;
  UPDATE leads SET early_exit_override = TRUE WHERE id = p_lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION override_followup_early_exit(UUID) TO authenticated;
