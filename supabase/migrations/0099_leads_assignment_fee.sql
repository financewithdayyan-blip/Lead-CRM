-- Assignment fee actually tied to a real lead, editable from the Property
-- tab — feeds "Average Assignment Fee" reporting once enough closed deals
-- have it filled in. Grouping "by market" uses the existing city/state
-- columns rather than a new freeform field.
alter table public.leads add column assignment_fee numeric;
