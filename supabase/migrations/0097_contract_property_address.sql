-- Collected once at send time (SendContractModal) so the invite SMS can
-- actually say which property the contract is for, and so Envelopes can
-- show it without guessing from mapped PDF fields that aren't filled in
-- until someone signs.
alter table public.contract_instances add column if not exists property_address text;
