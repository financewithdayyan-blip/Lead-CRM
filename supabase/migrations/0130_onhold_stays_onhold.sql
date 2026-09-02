-- ── On Hold leads stay on the On Hold board ─────────────────────────────
-- Until today, a reply from an On Hold lead moved the Kanban card to
-- Replied (sms-webhook's ADVANCE_FROM), and a completed AI qualification
-- moved it again to Partial Qualified/Qualified (ai-reply's fullyQualified
-- branch) — the same stage transitions any other lead gets. The user wants
-- On Hold leads to stay visually parked on the On Hold board through the
-- entire AI conversation — qualification, the photo/callback follow-up,
-- all of it — and only actually leave once a human moves it forward
-- (dragging to Negotiation/Contract once a deal is really happening,
-- exactly as today for every other stage transition that was already
-- manual-only). This migration only adds the tracking column; the actual
-- "don't change stage" logic lives in sms-webhook and ai-reply — see
-- their comments referencing onhold_reengaged.
--
-- onhold_reengaged marks a lead that has actually replied since entering
-- On Hold (as opposed to one still silently waiting on the escalating
-- nurture schedule) — send-onhold-followups excludes these, since sending
-- another "checking in" nurture text on top of a live or already-handled
-- conversation would be redundant/confusing. Reset to false alongside the
-- other onhold-tracking columns whenever a lead (re-)enters On Hold, same
-- reasoning as onhold_entered_at resetting on re-entry (0127): a lead that
-- goes on hold again later starts a fresh countdown, not a stale one.
alter table public.leads
  add column if not exists onhold_reengaged boolean not null default false;

create or replace function public.handle_onhold_followup_schedule()
returns trigger
language plpgsql
as $$
begin
  if NEW.stage = 'onhold' and (TG_OP = 'INSERT' or OLD.stage is distinct from 'onhold') then
    NEW.onhold_entered_at := now();
    NEW.onhold_followup_day := 5;
    NEW.next_onhold_followup_at := current_date + 5;
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

-- Data fix: 7 specific leads that already replied to today's On Hold
-- nurture text, before this fix shipped, had already been moved to Replied
-- by the old sms-webhook logic — move them back. Explicit id list (checked
-- by hand against lead_activities' onholdFollowup-tagged sends and each
-- lead's current stage right before writing this migration) rather than a
-- heuristic, since this is a one-time backfill for a known, already-
-- identified set — 2 other leads from the same nurture batch that instead
-- declined and correctly landed in Dead/Declined are deliberately left
-- alone, that outcome is unaffected by this change.
--
-- Two statements, deliberately: the first (setting stage) fires the trigger
-- above, which — same as any fresh entry into On Hold — resets
-- onhold_reengaged to false along with the schedule columns. The second
-- statement doesn't touch stage at all (the trigger is BEFORE UPDATE OF
-- stage, so it only fires when stage is in the SET list), so it corrects
-- onhold_reengaged back to true afterward without the trigger clobbering it
-- again — these leads have genuinely already replied, so they must stay
-- excluded from the nurture sweep, not read as a fresh silent entry.
update public.leads
set stage = 'onhold'
where id in (
  '17306b6c-752b-46cc-a30b-202d46048e14', -- Hajiba Zahour
  '7c889803-6a0e-4d42-aad6-dbbf8d08dd9f', -- Isreal Brownlow
  'a540fc84-c190-404d-b795-9f8755ac61f6', -- Andrew Allen
  'd72e7338-e9e7-465f-88d6-ebda9ad691fb', -- John Butler
  'eadddf86-e447-4805-8ba6-585f27f6dcf8', -- Marjoriann Pietrera
  'ec772d34-6cb4-4791-b75f-6e7257c846a1', -- Larry Balducci
  'ff5b87a8-d2ea-4221-95ca-cf58be56a220'  -- Marc Pirollo
);

update public.leads
set onhold_reengaged = true
where id in (
  '17306b6c-752b-46cc-a30b-202d46048e14',
  '7c889803-6a0e-4d42-aad6-dbbf8d08dd9f',
  'a540fc84-c190-404d-b795-9f8755ac61f6',
  'd72e7338-e9e7-465f-88d6-ebda9ad691fb',
  'eadddf86-e447-4805-8ba6-585f27f6dcf8',
  'ec772d34-6cb4-4791-b75f-6e7257c846a1',
  'ff5b87a8-d2ea-4221-95ca-cf58be56a220'
);
