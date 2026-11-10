-- Deal-progress tracking for the Disposition Messages tab's per-buyer deal
-- panel. Manually admin-marked, not auto-derived from a real e-sign/TC
-- integration (that doesn't exist yet) — "Deal packet sent" is the only
-- stage inferred from data that's already real (the recipient row itself
-- existing); every stage after it is a simple timestamp an admin sets by
-- clicking a button, so the checklist reflects real decisions, not
-- fabricated automation.

alter table public.disposition_send_recipients
  add column if not exists committed_price numeric,
  add column if not exists committed_at timestamptz,
  add column if not exists assignment_signed_at timestamptz,
  add column if not exists sent_to_tc_at timestamptz,
  add column if not exists closed_at timestamptz;
