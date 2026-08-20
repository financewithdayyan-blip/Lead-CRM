-- ============================================================================
-- Contract signing — email as a second delivery channel alongside SMS.
--
-- 10DLC carrier filtering has been blocking SMS that contain a link — which
-- is every message this system sends (invite, next-signer nudge, completion)
-- since they all carry the /crm/sign/{token} link. contract_signing_parties
-- already had an `email` column from the original design (0050) that was
-- never used once phone became the sole channel (0088) — this repurposes it
-- and adds explicit per-party flags for which channel(s) to actually use,
-- rather than inferring it from which fields happen to be filled in.
-- ============================================================================

alter table public.contract_signing_parties
  add column send_sms boolean not null default true,
  add column send_email boolean not null default false;

-- Loose sanity check only — never blocked or validated before, and the admin
-- UI already validates format client- and server-side.
alter table public.contract_signing_parties
  add constraint contract_signing_parties_email_format
    check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
