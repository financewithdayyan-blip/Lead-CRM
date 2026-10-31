-- process_auction_alerts() (0023) auto-moves a lead to Dead/Declined once its
-- auction date passes, with no exclusion for On Hold — the one on-hold-stage-
-- pinning rule (0130) was never applied here. An On Hold lead whose auction
-- date passes was silently pulled off the On Hold board by this daily cron,
-- the exact regression class 0130 exists to prevent, just via a path that
-- migration never touched. Fixed by leaving stage alone (still tracking
-- auction_tier and still notifying, truthfully, that nothing moved) whenever
-- the lead is currently On Hold — only a human drag moves it from there,
-- same as every other automated path in this codebase now respects.
create or replace function public.process_auction_alerts()
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    SELECT id, user_id, address, auction_date, auction_tier, last_alert_date, stage
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

    -- ── Auction passed: auto-dead + notification, unless On Hold ───
    IF v_tier = 'PAST' THEN
      IF r.stage = 'onhold' THEN
        UPDATE leads SET auction_tier = 'PAST' WHERE id = r.id;

        INSERT INTO lc_notifications (user_id, lead_id, type, title, body)
        VALUES (r.user_id, r.id, 'auction_passed',
                'Auction Passed — Still On Hold',
                'Lead at ' || v_addr || ' — the auction date has passed, but the lead is On Hold and was left there. Move it manually if it''s actually dead.');

        INSERT INTO lc_notifications (user_id, lead_id, type, title, body)
        SELECT p.id, r.id, 'auction_passed',
               'Auction Passed — Still On Hold',
               'Lead at ' || v_addr || ' — the auction date has passed, but the lead is On Hold and was left there. Move it manually if it''s actually dead.'
        FROM   profiles p
        WHERE  p.role = 'admin' AND p.id <> r.user_id;
      ELSE
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
      END IF;

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
