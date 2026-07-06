-- ============================================================
-- 0023: Auction Alert System
-- Adds lc_notifications table, auction_tier / last_alert_date
-- columns on leads, and a daily process_auction_alerts() stored
-- procedure that:
--   • recomputes tiers from auction_date - today each morning
--   • fires tier-change notifications immediately
--   • fires cadence reminders (LOW=7d, MEDIUM=3d, HIGH=2d, URGENT/CRITICAL=daily)
--   • auto-moves past-auction leads to dead_declined
--
-- The stored procedure is scheduled via pg_cron at 13:00 UTC
-- (≈ 8 AM CDT / 9 AM CST).  All logic lives in the DB so alerts
-- fire even when no user has the CRM open.
-- ============================================================

-- 1. Notifications table
CREATE TABLE IF NOT EXISTS lc_notifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id     UUID        REFERENCES leads(id) ON DELETE SET NULL,
  type        TEXT        NOT NULL,  -- 'auction_tier_change' | 'auction_cadence' | 'auction_passed'
  title       TEXT        NOT NULL,
  body        TEXT,
  is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lc_notifications_user_created
  ON lc_notifications (user_id, created_at DESC);

ALTER TABLE lc_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own notifications"
  ON lc_notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users update own notifications"
  ON lc_notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, UPDATE ON lc_notifications TO authenticated;

-- 2. New columns on leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS auction_tier    TEXT,
  ADD COLUMN IF NOT EXISTS last_alert_date DATE;

-- 3. Back-fill tier for any leads that already have an auction_date
UPDATE leads
SET auction_tier = CASE
    WHEN (auction_date - CURRENT_DATE) <= 0  THEN 'PAST'
    WHEN (auction_date - CURRENT_DATE) <= 3  THEN 'CRITICAL'
    WHEN (auction_date - CURRENT_DATE) <= 7  THEN 'URGENT'
    WHEN (auction_date - CURRENT_DATE) <= 14 THEN 'HIGH'
    WHEN (auction_date - CURRENT_DATE) <= 30 THEN 'MEDIUM'
    ELSE 'LOW'
  END
WHERE auction_date IS NOT NULL
  AND auction_tier IS NULL;

-- 4. Daily alert processor
CREATE OR REPLACE FUNCTION process_auction_alerts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r              RECORD;
  v_days         INT;
  v_tier         TEXT;
  v_cadence_days INT;
  v_should_alert BOOLEAN;
  v_today        DATE := CURRENT_DATE;
  v_plural       TEXT;
  v_addr         TEXT;
BEGIN
  FOR r IN
    SELECT id, user_id, address, auction_date, auction_tier, last_alert_date
    FROM   leads
    WHERE  auction_date IS NOT NULL
      AND  stage <> 'dead_declined'
  LOOP
    v_days   := (r.auction_date - v_today)::INT;
    v_plural := CASE WHEN v_days = 1 THEN '' ELSE 's' END;
    v_addr   := COALESCE(r.address, 'unknown address');

    -- Derive fresh tier
    v_tier := CASE
      WHEN v_days <= 0  THEN 'PAST'
      WHEN v_days <= 3  THEN 'CRITICAL'
      WHEN v_days <= 7  THEN 'URGENT'
      WHEN v_days <= 14 THEN 'HIGH'
      WHEN v_days <= 30 THEN 'MEDIUM'
      ELSE 'LOW'
    END;

    -- ── Auction passed: auto-dead + notification ───────────────
    IF v_tier = 'PAST' THEN
      UPDATE leads SET stage = 'dead_declined', auction_tier = 'PAST'
        WHERE id = r.id;

      INSERT INTO lc_notifications (user_id, lead_id, type, title, body)
      VALUES (r.user_id, r.id, 'auction_passed',
              'Auction Passed — Lead Auto-Closed',
              'Lead at ' || v_addr || ' was automatically moved to Dead/Declined — the auction date has passed.');

      INSERT INTO lc_notifications (user_id, lead_id, type, title, body)
      SELECT p.id, r.id, 'auction_passed',
             'Auction Passed — Lead Auto-Closed',
             'Lead at ' || v_addr || ' was automatically moved to Dead/Declined — the auction date has passed.'
      FROM   profiles p
      WHERE  p.role = 'admin' AND p.id <> r.user_id;

      CONTINUE;
    END IF;

    -- ── Tier changed: update + immediate notification ──────────
    IF v_tier IS DISTINCT FROM r.auction_tier THEN
      UPDATE leads SET auction_tier = v_tier, last_alert_date = v_today
        WHERE id = r.id;

      -- Only alert on an actual downgrade (not the very first tier set)
      IF r.auction_tier IS NOT NULL THEN
        INSERT INTO lc_notifications (user_id, lead_id, type, title, body)
        VALUES (r.user_id, r.id, 'auction_tier_change',
                'Auction Alert — ' || v_tier,
                'Lead at ' || v_addr || ' moved to ' || v_tier ||
                ' — auction in ' || v_days || ' day' || v_plural || '.');

        INSERT INTO lc_notifications (user_id, lead_id, type, title, body)
        SELECT p.id, r.id, 'auction_tier_change',
               'Auction Alert — ' || v_tier,
               'Lead at ' || v_addr || ' moved to ' || v_tier ||
               ' — auction in ' || v_days || ' day' || v_plural || '.'
        FROM   profiles p
        WHERE  p.role = 'admin' AND p.id <> r.user_id;
      END IF;

      CONTINUE;  -- already alerted today via tier-change
    END IF;

    -- ── Scheduled cadence alert ────────────────────────────────
    v_cadence_days := CASE v_tier
      WHEN 'CRITICAL' THEN 1
      WHEN 'URGENT'   THEN 1
      WHEN 'HIGH'     THEN 2
      WHEN 'MEDIUM'   THEN 3
      WHEN 'LOW'      THEN 7
      ELSE NULL
    END;

    v_should_alert := (
      v_cadence_days IS NOT NULL AND
      (r.last_alert_date IS NULL OR (v_today - r.last_alert_date) >= v_cadence_days)
    );

    IF v_should_alert THEN
      INSERT INTO lc_notifications (user_id, lead_id, type, title, body)
      VALUES (r.user_id, r.id, 'auction_cadence',
              'Auction Reminder — ' || v_tier,
              'Lead at ' || v_addr ||
              ' — auction in ' || v_days || ' day' || v_plural || '.');

      INSERT INTO lc_notifications (user_id, lead_id, type, title, body)
      SELECT p.id, r.id, 'auction_cadence',
             'Auction Reminder — ' || v_tier,
             'Lead at ' || v_addr ||
             ' — auction in ' || v_days || ' day' || v_plural || '.'
      FROM   profiles p
      WHERE  p.role = 'admin' AND p.id <> r.user_id;

      UPDATE leads SET last_alert_date = v_today WHERE id = r.id;
    END IF;

  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION process_auction_alerts() TO authenticated;

-- 5. pg_cron schedule — 13:00 UTC daily (≈ 8 AM CDT / 9 AM CST)
--    Silently skipped if the pg_cron extension is not enabled.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'auction-alerts',
      '0 13 * * *',
      'SELECT process_auction_alerts()'
    );
  END IF;
END;
$$;
