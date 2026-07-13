-- Automatically delete ride requests (and, via cascading foreign keys, their
-- ride_offers and notifications rows) once their shuttle time is more than
-- an hour in the past. This is plain periodic DB maintenance with no
-- external API calls involved, so it runs via pg_cron rather than routing
-- through a GitHub Actions workflow + edge function like the reminder emails
-- do.
--
-- shuttle_date/shuttle_time are stored as plain local wall-clock values (see
-- notify-neighbors' ICS_TIMEZONE comment) - "AT TIME ZONE 'America/New_York'"
-- interprets the naive timestamp as being in that zone and converts it to a
-- real UTC instant, correctly accounting for DST, so this lines up with the
-- same assumption used everywhere else in the app.

create extension if not exists pg_cron;

create or replace function delete_expired_ride_requests()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from ride_requests
  where (shuttle_date + shuttle_time) at time zone 'America/New_York' + interval '1 hour' < now();
end;
$$;

-- cron.schedule() is idempotent by job name - re-running this migration
-- (e.g. on a fresh `supabase db push`) updates the existing job in place
-- rather than creating a duplicate.
select cron.schedule(
  'delete-expired-ride-requests',
  '*/15 * * * *',
  $$select delete_expired_ride_requests();$$
);
