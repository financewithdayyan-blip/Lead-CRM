-- One-time repair: fix auction_date values where the year is clearly wrong
-- (e.g. 2001, caused by the old parseFlexibleDate bug on yearless date strings
-- like "Thursday 9 July"). For each affected lead, the month and day are kept
-- and the year is inferred: current year if that date is still in the future,
-- otherwise next year.

DO $$
DECLARE
  r       RECORD;
  today   DATE := CURRENT_DATE;
  v_month INT;
  v_day   INT;
  v_fixed DATE;
BEGIN
  FOR r IN
    SELECT id, auction_date
    FROM   leads
    WHERE  auction_date IS NOT NULL
      AND  EXTRACT(YEAR FROM auction_date) < 2020   -- anything before 2020 is a parser artifact
  LOOP
    v_month := EXTRACT(MONTH FROM r.auction_date)::INT;
    v_day   := EXTRACT(DAY   FROM r.auction_date)::INT;

    -- Try current calendar year first
    v_fixed := make_date(EXTRACT(YEAR FROM today)::INT, v_month, v_day);

    -- If that date is already past, roll one year forward
    IF v_fixed < today THEN
      v_fixed := make_date(EXTRACT(YEAR FROM today)::INT + 1, v_month, v_day);
    END IF;

    UPDATE leads SET auction_date = v_fixed WHERE id = r.id;

    RAISE NOTICE 'Repaired lead %: % → %', r.id, r.auction_date, v_fixed;
  END LOOP;
END;
$$;
