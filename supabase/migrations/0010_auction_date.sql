-- Auction date for pre-foreclosure leads, settable via CSV import mapping or
-- manually on the lead's Property Details tab, surfaced on Kanban cards.
alter table public.leads add column auction_date date;
