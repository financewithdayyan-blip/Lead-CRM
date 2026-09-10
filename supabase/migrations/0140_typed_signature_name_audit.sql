-- The signature name field on the public signing page (public/crm/sign/<token>)
-- was pre-filled with the name already on record for the party, so a signer
-- could complete signing without ever typing anything themselves — weak
-- grounds for the "affirmative act" an electronic signature is supposed to
-- show under ESIGN/UETA. The frontend now leaves that field blank; this
-- column is the durable, literal record of what they actually typed (the
-- signature_data_url column already exists but only holds a rendered image,
-- not queryable/comparable text).
alter table contract_signing_parties add column if not exists typed_signature_name text;
