-- Backup/primary trigger for the day-before/day-of reminder emails, running
-- via pg_cron (same mechanism used for the ride-request cleanup job in
-- 0011) instead of relying solely on GitHub Actions' scheduled workflow.
-- GitHub's cron triggers have repeatedly run late or been skipped in
-- practice for this project (confirmed empirically more than once); pg_cron
-- runs inside Supabase's own infrastructure and isn't subject to that.
--
-- The GitHub Actions workflow (.github/workflows/reminders.yml) can stay in
-- place - send-reminders is idempotent per day (it checks
-- last_reminder_sent before sending), so an extra trigger on a day it
-- already ran is a harmless no-op, not a duplicate email.
--
-- The CRON_SECRET this needs to authenticate to the edge function is
-- intentionally NOT set by this migration - secrets shouldn't live in
-- migration files. Store it once, yourself, by running the following in the
-- Supabase SQL editor (replace the placeholder with the same value you used
-- for `supabase secrets set CRON_SECRET=...`):
--
--   select vault.create_secret(
--     'YOUR_ACTUAL_CRON_SECRET_VALUE',
--     'cron_secret',
--     'Used by pg_cron to authenticate to the send-reminders edge function'
--   );
--
-- Until that's run, trigger_send_reminders() below is a harmless no-op (it
-- logs a notice and returns without calling anything).

create or replace function trigger_send_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_secret'
  limit 1;

  if v_secret is null then
    raise notice 'cron_secret not set in Vault yet - skipping send-reminders trigger';
    return;
  end if;

  perform net.http_post(
    url := 'https://gbgzyghfnhfppsobjaez.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
end;
$$;

-- Same two times as the GitHub Actions workflow (13:00 / 19:00 UTC, roughly
-- morning/afternoon Eastern) - cron.schedule() is idempotent by job name, so
-- re-running this migration updates the existing jobs rather than
-- duplicating them.
select cron.schedule(
  'send-reminders-morning',
  '0 13 * * *',
  $$select trigger_send_reminders();$$
);

select cron.schedule(
  'send-reminders-evening',
  '0 19 * * *',
  $$select trigger_send_reminders();$$
);
