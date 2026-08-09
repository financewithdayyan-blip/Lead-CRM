-- Tracks leads where the contact confirmed they're not the property owner
-- (or no longer own it) and the AI asked whether they know the owner /
-- a way to reach them, but got no further reply. Lets send-reminders tell
-- this specific stall apart from an ordinary mid-framework one: after one
-- reminder has already gone out and the lead is still silent, it gets moved
-- to Dead/Declined instead of being reminded indefinitely.
alter table leads add column awaiting_owner_info boolean not null default false;
