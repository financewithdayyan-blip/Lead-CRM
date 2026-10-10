-- Adds 'contract' as a recognized lead_activities.type — the Activity tab
-- now logs "Contract generated" as its own event (see CreateContractButton's
-- onSent handler) alongside the existing note/call/email/meeting/sms/
-- stage_change set, instead of having no record of a contract going out at
-- all.
alter table public.lead_activities drop constraint lead_activities_type_check;
alter table public.lead_activities add constraint lead_activities_type_check
  check (type in ('note', 'call', 'email', 'meeting', 'sms', 'stage_change', 'contract'));
