-- Sending a contract no longer requires picking a CRM lead first — the
-- contract's own name identifies the deal, and buyer/seller are entered
-- directly. lead_id stays around for whichever contracts do have one, just
-- no longer required.
alter table public.contract_instances alter column lead_id drop not null;
