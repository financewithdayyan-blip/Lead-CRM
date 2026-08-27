-- Adds the one field the old sync source (GET /v2/phone/sms/sessions) never
-- gave us: who the message was actually with. Without it there was no way
-- to tell a lead-outreach message from a cash-buyer conversation — both ride
-- the same shared Zoom numbers (send-buyer-sms uses the identical NUMBERS
-- map as send-sms), so every sync silently mixed buyer traffic into the
-- dashboard's "delivered"/"replies" counts. The account now has the
-- phone:read:sms_charges:admin scope, whose report includes from_number/
-- to_number on every message — sync-sms-delivery-stats is being rewritten
-- to pull from that endpoint instead, storing whichever side isn't one of
-- our own numbers as counterparty_number so the dashboard can filter out
-- known cash-buyer numbers before computing rates.
alter table public.sms_delivery_log add column counterparty_number text;

create index sms_delivery_log_counterparty_idx on public.sms_delivery_log (counterparty_number);
