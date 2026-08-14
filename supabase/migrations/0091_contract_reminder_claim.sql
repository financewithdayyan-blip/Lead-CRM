-- Blue Docs overhaul, phase 1c — atomic claim for the reminder sweep, same
-- claim-before-work shape as send-reminders/bulk-sms-dispatcher (an UPDATE
-- ... RETURNING is fully serialized by Postgres row locking, so this is safe
-- even if the sweep somehow overlapped itself, not just safe on a single
-- proven schedule).
--
-- Cadence: first reminder 24h after the party was invited (their 'sent'
-- audit event) with no reminder sent yet; then every 72h after; hard cap of
-- 3 total. Only ever claims a party that's currently unlocked (no earlier
-- sign_order still pending) on a still-open instance.
create or replace function public.claim_contract_reminders(p_limit int default 50)
returns table (
  id uuid,
  name text,
  phone text,
  access_token uuid,
  contract_instance_id uuid,
  contract_name text
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
      and p2.phone is not null
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
  returning p.id, p.name, p.phone, p.access_token, p.contract_instance_id,
    (select ci2.name from public.contract_instances ci2 where ci2.id = p.contract_instance_id);
end;
$$;

revoke all on function public.claim_contract_reminders(int) from public;
