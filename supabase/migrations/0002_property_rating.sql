-- Seller's own rating of their property (asked during the call), distinct
-- from the existing `rating` column which is the rep's star rating of the lead.
alter table public.leads
  add column property_rating int check (property_rating is null or property_rating between 1 and 10);
