-- Destinations are now community-configurable rather than a single fixed
-- "shuttle stop", so generated notification text should no longer say
-- "shuttle" - it reads oddly once a ride might be to/from a grocery store,
-- a friend's house, etc. This just redefines the three functions that
-- build user-facing notification bodies referencing the ride time, dropping
-- the word "shuttle" from the generated text. Internal column/variable
-- names (shuttle_date, shuttle_time, v_shuttle_date, v_shuttle_time) are
-- left as-is - renaming the underlying columns is a separate, larger change
-- not needed here.

create or replace function public.accept_ride_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
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
    v_driver_name || ' will give you a ride, at ' || v_shuttle_time || ' on ' || v_shuttle_date || '.',
    v_request_id,
    v_driver_id
  );

  -- Auto-decline every other pending offer for this request, and notify each
  -- of those neighbors that it's already covered - without naming who
  -- covered it, for privacy. No related_user_id either, since that's what
  -- drives the "Email <name>" contact link in the notification UI.
  for r in
    update ride_offers
      set status = 'declined', responded_at = now()
      where ride_request_id = v_request_id and id <> p_offer_id and status = 'pending'
      returning driver_id
  loop
    insert into notifications (user_id, type, title, body, ride_request_id)
    values (
      r.driver_id,
      'ride_declined',
      'Ride already covered',
      'Another neighbor has already committed to give ' || v_requester_name || ' a ride at ' || v_shuttle_time || ' on ' || v_shuttle_date || '. You don''t need to do anything.',
      v_request_id
    );
  end loop;
end;
$$;

create or replace function public.cancel_ride_offer(p_offer_id uuid, p_note text default null::text)
returns void
language plpgsql
security definer
set search_path = public
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
      v_driver_name || ' can no longer give you a ride at ' || v_shuttle_time || ' on ' || v_shuttle_date || '. ' ||
        case when nullif(trim(p_note), '') is not null then p_note else 'Sorry for the inconvenience.' end ||
        ' It''s been reopened to other neighbors.',
      v_request_id,
      v_driver_id
    );
  end if;
end;
$$;

create or replace function public.cancel_ride_request(p_request_id uuid, p_note text default null::text)
returns void
language plpgsql
security definer
set search_path = public
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
      v_requester_name || ' cancelled the ride request for ' || v_shuttle_time || ' on ' || v_shuttle_date || '. ' ||
        case when nullif(trim(p_note), '') is not null then p_note else 'Sorry for the inconvenience.' end ||
        ' If you added this to your calendar, remember to remove it too.',
      p_request_id,
      v_requester_id
    );
  end if;
end;
$$;
