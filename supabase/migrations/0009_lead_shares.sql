-- ── lead_shares ──────────────────────────────────────────────────────────────
-- A caller can hand a lead off to an admin (pending approval). Records who sent
-- it and what stage the lead was in at that moment, for display purposes.
create table public.lead_shares (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  from_user_id uuid not null references public.profiles(id) on delete cascade,
  to_user_id uuid references public.profiles(id) on delete cascade,
  stage_at_share text not null check (stage_at_share in
    ('new', 'voicemail', 'initial_contact', 'followup', 'negotiation', 'contract', 'dead_declined', 'onhold')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index lead_shares_lead_id_idx on public.lead_shares (lead_id);
create index lead_shares_from_user_id_idx on public.lead_shares (from_user_id);
create index lead_shares_status_idx on public.lead_shares (status);
-- At most one open share per lead at a time.
create unique index lead_shares_one_pending_per_lead on public.lead_shares (lead_id) where status = 'pending';

alter table public.lead_shares enable row level security;

create policy "lead_shares_select" on public.lead_shares
  for select using (from_user_id = auth.uid() or to_user_id = auth.uid() or public.current_role() = 'admin');

create policy "lead_shares_insert_own_lead" on public.lead_shares
  for insert with check (
    from_user_id = auth.uid()
    and exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())
  );

-- Declining only touches this one row, so a plain RLS policy is enough.
-- Accepting also reassigns the lead (and its tasks), which needs the
-- security-definer function below to bypass tasks' own-rows-only policy.
create policy "lead_shares_decline" on public.lead_shares
  for update using (public.current_role() = 'admin' and status = 'pending')
  with check (public.current_role() = 'admin');

-- Let any admin see the lead a share points at while it's still pending, even
-- before they own it or oversee its current owner. Once resolved, visibility
-- reverts to the normal ownership/overseer rules on public.leads.
create policy "leads_select_via_pending_share" on public.leads
  for select using (
    public.current_role() = 'admin'
    and exists (select 1 from public.lead_shares ls where ls.lead_id = id and ls.status = 'pending')
  );

create or replace function public.accept_lead_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
  v_status text;
begin
  if public.current_role() <> 'admin' then
    raise exception 'Only admins can accept lead shares';
  end if;

  select lead_id, status into v_lead_id, v_status from public.lead_shares where id = p_share_id;
  if v_lead_id is null then
    raise exception 'Share not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'This share has already been resolved';
  end if;

  update public.lead_shares set status = 'accepted', to_user_id = auth.uid(), resolved_at = now() where id = p_share_id;
  update public.leads set user_id = auth.uid() where id = v_lead_id;
  update public.tasks set user_id = auth.uid() where lead_id = v_lead_id;
end;
$$;

-- Lets an admin pull a lead straight into their own pipeline while viewing a
-- team member's leads, without going through the pending-share workflow.
create or replace function public.transfer_lead_to_admin(p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'admin' then
    raise exception 'Only admins can transfer leads';
  end if;

  update public.leads set user_id = auth.uid() where id = p_lead_id;
  update public.tasks set user_id = auth.uid() where lead_id = p_lead_id;
end;
$$;
