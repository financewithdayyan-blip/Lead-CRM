-- New website contact-form submissions (web_leads) only reached the CRM via
-- a 60s poll, so a lead could sit up to a full minute before an admin saw
-- it. Adding the table to the realtime publication lets useWebLeads push an
-- update the moment a row lands, the same pattern already used for tasks
-- (see 0059_task_auto_created_and_realtime.sql).
alter publication supabase_realtime add table public.web_leads;
