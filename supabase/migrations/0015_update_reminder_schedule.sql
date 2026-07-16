-- Move the reminder-email trigger times from 9 AM / 3 PM Eastern to
-- 6 AM / 1 PM Eastern. cron.schedule() re-targets an existing job in place
-- when called again with the same job name, so this just updates the two
-- jobs created in 0012_pg_cron_reminder_trigger.sql rather than creating
-- new ones.
--
-- 10:00 / 17:00 UTC = 6 AM / 1 PM EDT (Eastern is currently in daylight
-- time, UTC-4). Same caveat as before: these are fixed UTC times, so they
-- drift an hour relative to Eastern across the DST boundary.

select cron.schedule(
  'send-reminders-morning',
  '0 10 * * *',
  $$select trigger_send_reminders();$$
);

select cron.schedule(
  'send-reminders-evening',
  '0 17 * * *',
  $$select trigger_send_reminders();$$
);
