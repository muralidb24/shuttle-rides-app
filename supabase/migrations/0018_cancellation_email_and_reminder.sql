-- Two things:
--
-- 1. cancel_ride_request notifies the driver (who may have added the ride to
--    their own calendar after accepting it - see CalendarPrompt.tsx). The
--    app has no way to remove that calendar entry for them, since it was
--    added via a one-way Google Calendar link / ICS download, not a real
--    two-way calendar integration - so the notification text now explicitly
--    reminds them to remove it themselves. (cancel_ride_offer notifies the
--    *requester* instead, who never had a calendar entry in the first place,
--    so it's left unchanged - the reminder for a driver-initiated cancel is
--    handled client-side instead, in CancelDialog.)
--
-- 2. Until now, only the initial "ride requested" notification ever got
--    emailed (via the notify-neighbors edge function) - accept/decline/
--    cancel notifications only ever showed up in-app and (as of
--    0016_push_notifications.sql) as a push. This adds a generic
--    AFTER INSERT trigger, mirroring trigger_send_push(), that emails every
--    *other* notification type too. 'ride_requested' is deliberately
--    excluded since it already gets its own richer, custom-formatted email
--    from notify-neighbors - this would otherwise double-email it.

create or replace function cancel_ride_request(p_request_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_requester_id uuid;
  v_requester_name text;
  v_driver_id uuid;
  v_shuttle_date date;
  v_shuttle_time time;
begin
  select requester_id, shuttle_date, shuttle_time into v_requester_id, v_shuttle_date, v_shuttle_time
    from ride_requests where id = p_request_id;
  if v_requester_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  select driver_id into v_driver_id from ride_offers where ride_request_id = p_request_id and status = 'accepted' limit 1;

  update ride_requests set status = 'cancelled', cancel_note = nullif(trim(p_note), '') where id = p_request_id;
  update ride_offers set status = 'cancelled', responded_at = now()
    where ride_request_id = p_request_id and status in ('pending', 'accepted');

  if v_driver_id is not null then
    select full_name into v_requester_name from profiles where id = v_requester_id;
    insert into notifications (user_id, type, title, body, ride_request_id, related_user_id)
    values (
      v_driver_id,
      'ride_cancelled',
      'Ride cancelled',
      v_requester_name || ' cancelled the ride request for the ' || v_shuttle_time || ' shuttle on ' || v_shuttle_date || '. ' ||
        case when nullif(trim(p_note), '') is not null then p_note else 'Sorry for the inconvenience.' end ||
        ' If you added this to your calendar, remember to remove it too.',
      p_request_id,
      v_requester_id
    );
  end if;
end;
$$;
grant execute on function cancel_ride_request(uuid, text) to authenticated;

create or replace function trigger_send_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  if new.type = 'ride_requested' then
    return new;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_secret'
  limit 1;

  if v_secret is null then
    raise notice 'cron_secret not set in Vault yet - skipping send-notification-email trigger';
    return new;
  end if;

  perform net.http_post(
    url := 'https://gbgzyghfnhfppsobjaez.supabase.co/functions/v1/send-notification-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('notification_id', new.id)
  );

  return new;
end;
$$;

create trigger notifications_send_email
  after insert on notifications
  for each row
  execute function trigger_send_email();
