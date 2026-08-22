-- ============================================================================
-- Cash buyers were being contacted via a Facebook group ("475806599296578"),
-- and admins had been pasting each buyer's group-member profile URL into the
-- free-text notes field just to have somewhere to click through to DM them.
-- Promoting it to a real column gets it a dedicated Facebook-icon link in the
-- UI instead of a notes scavenger hunt.
--
-- Backfill: every existing note containing a facebook.com link follows the
-- same "...free text...\nhttps://www.facebook.com/..." shape (confirmed by
-- reading all current rows) — pull that URL into facebook_url and strip it
-- back out of notes so it isn't duplicated in both places.
-- ============================================================================

alter table public.cash_buyers add column facebook_url text;

update public.cash_buyers
set
  facebook_url = (regexp_match(notes, 'https?://\S*facebook\.com\S*'))[1],
  notes = nullif(trim(both e' \n\t\r' from regexp_replace(notes, '\s*https?://\S*facebook\.com\S*', '', 'gi')), '')
where notes ~* 'facebook\.com';
