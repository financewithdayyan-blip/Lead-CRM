-- The SMS thread on a lead's profile only ever loaded once — a reply, or a
-- text sent from the Zoom app directly (now logged by sms-webhook's own fix
-- for messages sent outside the CRM), needed a manual reopen of the tab to
-- appear. Adding both source tables to the realtime publication lets
-- useLeadThread push an update the instant either changes, same pattern as
-- tasks (0059) and web_leads (0121).
alter publication supabase_realtime add table public.inbound_messages;
alter publication supabase_realtime add table public.lead_activities;
