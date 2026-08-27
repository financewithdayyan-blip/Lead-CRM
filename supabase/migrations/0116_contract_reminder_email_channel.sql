-- The automatic reminder sweep only ever claimed a party with a phone number
-- on file (`p2.phone is not null`), and only ever texted them — an
-- email-only signing party (send_email true, send_sms false, phone null)
-- was silently never reminded at all, forever. Broadens eligibility to
-- either delivery channel actually being usable, and returns email/
-- send_sms/send_email so the sweep function can pick the right channel(s)
-- per party, the same way create-contract-instance/submit-signature already
-- do for the initial invite and the next-signer nudge.
-- Return shape (OUT columns) changed from 0091's version — replace requires
-- a matching signature, so the old one has to go first.
drop function if exists public.claim_contract_reminders(int);

create or replace function public.claim_contract_reminders(p_limit int default 50)
returns table (
  id uuid,
  name text,
  phone text,
  email text,
  send_sms boolean,
  send_email boolean,
  access_token uuid,
  contract_instance_id uuid,
  contract_name text,
  property_address text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.contract_signing_parties p
  set reminder_count = p.reminder_count + 1,
      last_reminded_at = now()
  from (
    select p2.id
    from public.contract_signing_parties p2
    join public.contract_instances ci on ci.id = p2.contract_instance_id
    where p2.status = 'pending'
      and ((p2.send_sms and p2.phone is not null) or (p2.send_email and p2.email is not null))
      and ci.status in ('sent', 'partial')
      and p2.reminder_count < 3
      and not exists (
        select 1 from public.contract_signing_parties p3
        where p3.contract_instance_id = p2.contract_instance_id
          and p3.sign_order < p2.sign_order
          and p3.status <> 'signed'
      )
      and (
        (p2.last_reminded_at is null and exists (
          select 1 from public.contract_audit_events e
          where e.party_id = p2.id and e.event_type = 'sent'
            and e.created_at < now() - interval '24 hours'
        ))
        or (p2.last_reminded_at is not null and p2.last_reminded_at < now() - interval '72 hours')
      )
    limit p_limit
    for update of p2 skip locked
  ) claimed
  where p.id = claimed.id
  returning p.id, p.name, p.phone, p.email, p.send_sms, p.send_email, p.access_token, p.contract_instance_id,
    (select ci2.name from public.contract_instances ci2 where ci2.id = p.contract_instance_id),
    (select ci2.property_address from public.contract_instances ci2 where ci2.id = p.contract_instance_id);
end;
$$;

revoke all on function public.claim_contract_reminders(int) from public;
