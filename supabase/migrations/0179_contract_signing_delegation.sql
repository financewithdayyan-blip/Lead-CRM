-- ============================================================================
-- Seller-side signing delegation.
--
-- Real scenario: the PSA sometimes has to go out to whoever is representing
-- the seller (a realtor, an attorney) rather than the seller directly — that
-- person was never meant to sign as the seller themselves, only to relay the
-- document to the actual owner. Lets a seller-side party (role 'seller' or
-- 'seller_2') hand their own signing link off to the real signer once,
-- before they've signed anything, via the new delegate-signing-party edge
-- function. Buyer-side delegation is intentionally not offered anywhere —
-- this is a seller-only escape hatch for exactly the one scenario above.
--
-- In-place reassignment on the SAME contract_signing_parties row (not a
-- second row for the same role) — every other part of this flow assumes one
-- row per role (partyByRole/existingByRole maps in submit-signature and
-- update-contract-instance), and a second 'seller' row would break that.
-- name/phone/email get overwritten to the real signer's info; the
-- intermediary's own original contact info is preserved here so the
-- certificate and admin audit view can still say who the document actually
-- went through. A fresh access_token is issued in the same update, which is
-- what invalidates the intermediary's old link — get_signing_party only
-- ever matches an exact token, so the old UUID simply stops resolving to
-- anything, same as any other dead link, the moment it's overwritten.
-- ============================================================================

alter table public.contract_signing_parties
  add column if not exists delegated_from_name text,
  add column if not exists delegated_from_phone text,
  add column if not exists delegated_from_email text,
  add column if not exists delegated_at timestamptz;

-- Free-text note alongside an audit event — used by 'delegated' to record
-- exactly who forwarded to whom (the party row's own name has already
-- changed to the new signer by the time this renders, so the generic
-- "{party name} {action}" pattern everywhere else can't tell this story on
-- its own). Nullable, left blank for every other existing event type.
alter table public.contract_audit_events
  add column if not exists detail text;

alter table public.contract_audit_events drop constraint if exists contract_audit_events_event_type_check;
alter table public.contract_audit_events add constraint contract_audit_events_event_type_check
  check (event_type = any (array[
    'viewed', 'consented', 'signed', 'sent', 'reminder_sent', 'declined',
    'voided', 'expired', 'edited', 'field_signed', 'signature_remembered',
    'delegated'
  ]));
