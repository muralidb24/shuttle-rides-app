-- When one neighbor accepts a ride offer, every other neighbor who had a
-- pending offer for that same request gets auto-declined. Previously that
-- was silent - their "Needs your response" card would just vanish (now that
-- realtime is enabled) with no explanation. This adds an explicit
-- notification to each of those neighbors so their alert bell reflects it:
-- "Ride already covered".

create or replace function accept_ride_offer(p_offer_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_request_id uuid;
  v_driver_id uuid;
  v_requester_id uuid;
  v_driver_name text;
  v_requester_name text;
  v_shuttle_date date;
  v_shuttle_time time;
  r record;
begin
  select ride_request_id, driver_id into v_request_id, v_driver_id from ride_offers where id = p_offer_id;
  if v_driver_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  update ride_offers set status = 'accepted', responded_at = now() where id = p_offer_id;
  update ride_requests set status = 'matched' where id = v_request_id;

  select requester_id, shuttle_date, shuttle_time into v_requester_id, v_shuttle_date, v_shuttle_time
    from ride_requests where id = v_request_id;
  select full_name into v_driver_name from profiles where id = v_driver_id;
  select full_name into v_requester_name from profiles where id = v_requester_id;

  insert into notifications (user_id, type, title, body, ride_request_id, related_user_id)
  values (
    v_requester_id,
    'ride_accepted',
    'Ride confirmed',
    v_driver_name || ' will give you a ride. Shuttle at ' || v_shuttle_time || ' on ' || v_shuttle_date || '.',
    v_request_id,
    v_driver_id
  );

  -- Auto-decline every other pending offer for this request, and notify each
  -- of those neighbors that it's already covered.
  for r in
    update ride_offers
      set status = 'declined', responded_at = now()
      where ride_request_id = v_request_id and id <> p_offer_id and status = 'pending'
      returning driver_id
  loop
    insert into notifications (user_id, type, title, body, ride_request_id, related_user_id)
    values (
      r.driver_id,
      'ride_declined',
      'Ride already covered',
      v_driver_name || ' is giving ' || v_requester_name || ' a ride for the ' || v_shuttle_time || ' shuttle on ' || v_shuttle_date || '. You don''t need to do anything.',
      v_request_id,
      v_driver_id
    );
  end loop;
end;
$$;
grant execute on function accept_ride_offer(uuid) to authenticated;
