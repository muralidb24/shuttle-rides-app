-- Include the shuttle date/time in accept/cancel notification bodies so the
-- bell shows which ride is being confirmed or cancelled, not just names.

create or replace function accept_ride_offer(p_offer_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_request_id uuid;
  v_driver_id uuid;
  v_requester_id uuid;
  v_driver_name text;
  v_shuttle_date date;
  v_shuttle_time time;
begin
  select ride_request_id, driver_id into v_request_id, v_driver_id from ride_offers where id = p_offer_id;
  if v_driver_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  update ride_offers set status = 'accepted', responded_at = now() where id = p_offer_id;
  update ride_offers set status = 'declined', responded_at = now()
    where ride_request_id = v_request_id and id <> p_offer_id and status = 'pending';
  update ride_requests set status = 'matched' where id = v_request_id;

  select requester_id, shuttle_date, shuttle_time into v_requester_id, v_shuttle_date, v_shuttle_time
    from ride_requests where id = v_request_id;
  select full_name into v_driver_name from profiles where id = v_driver_id;

  insert into notifications (user_id, type, title, body, ride_request_id, related_user_id)
  values (
    v_requester_id,
    'ride_accepted',
    'Ride confirmed',
    v_driver_name || ' will give you a ride. Shuttle at ' || v_shuttle_time || ' on ' || v_shuttle_date || '.',
    v_request_id,
    v_driver_id
  );
end;
$$;
grant execute on function accept_ride_offer(uuid) to authenticated;

create or replace function cancel_ride_offer(p_offer_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_request_id uuid;
  v_driver_id uuid;
  v_requester_id uuid;
  v_driver_name text;
  v_was_accepted boolean;
  v_shuttle_date date;
  v_shuttle_time time;
begin
  select ride_request_id, driver_id, (status = 'accepted') into v_request_id, v_driver_id, v_was_accepted
    from ride_offers where id = p_offer_id;
  if v_driver_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  update ride_offers set status = 'cancelled', responded_at = now(), cancel_note = nullif(trim(p_note), '') where id = p_offer_id;
  update ride_requests set status = 'open' where id = v_request_id;

  if v_was_accepted then
    select requester_id, shuttle_date, shuttle_time into v_requester_id, v_shuttle_date, v_shuttle_time
      from ride_requests where id = v_request_id;
    select full_name into v_driver_name from profiles where id = v_driver_id;
    insert into notifications (user_id, type, title, body, ride_request_id, related_user_id)
    values (
      v_requester_id,
      'ride_cancelled',
      'Ride cancelled',
      v_driver_name || ' can no longer give you a ride for the ' || v_shuttle_time || ' shuttle on ' || v_shuttle_date || '. ' ||
        case when nullif(trim(p_note), '') is not null then p_note else 'Sorry for the inconvenience.' end ||
        ' It''s been reopened to other neighbors.',
      v_request_id,
      v_driver_id
    );
  end if;
end;
$$;
grant execute on function cancel_ride_offer(uuid, text) to authenticated;

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
        case when nullif(trim(p_note), '') is not null then p_note else 'Sorry for the inconvenience.' end,
      p_request_id,
      v_requester_id
    );
  end if;
end;
$$;
grant execute on function cancel_ride_request(uuid, text) to authenticated;
