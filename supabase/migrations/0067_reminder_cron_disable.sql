-- Reverts 0066: reminders are now button-only (the "Send Reminder Messages"
-- action on Kanban), not an unattended daily cron. Unschedule the job; leave
-- pg_cron/pg_net enabled from 0065 in case something else needs them later.
select cron.unschedule('send-daily-reminders');
