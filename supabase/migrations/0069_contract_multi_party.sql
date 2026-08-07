-- Lets a contract have more than the two mapped roles (buyer/seller) as
-- signers — e.g. a witness or a co-seller who reviews and signs but has no
-- fields of their own mapped on the template. Their signing order is just
-- their position among all parties (sign_order already supported any values;
-- this only widens which role text is valid).
alter table public.contract_signing_parties
  drop constraint contract_signing_parties_role_check,
  add constraint contract_signing_parties_role_check check (role in ('buyer', 'seller', 'other'));
