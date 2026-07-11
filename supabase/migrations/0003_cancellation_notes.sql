-- Optional cancellation notes for both cancel paths.
-- Already applied directly to the live project via the Supabase MCP connector;
-- kept here so `supabase db push` stays in sync for anyone re-provisioning.

alter table ride_offers add column if not exists cancel_note text;
alter table ride_requests add column if not exists cancel_note text;

drop function if exists cancel_ride_offer(uuid);
drop function if exists cancel_ride_request(uuid);

create or replace function cancel_ride_offer(p_offer_id uuid, p_note text default null)
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
begin
  select ride_request_id, driver_id, (status = 'accepted') into v_request_id, v_driver_id, v_was_accepted
  from ride_offers where id = p_offer_id;

  if v_driver_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  update ride_offers
    set status = 'cancelled', responded_at = now(), cancel_note = nullif(trim(p_note), '')
    where id = p_offer_id;

  update ride_requests
    set status = 'open'
    where id = v_request_id;

  if v_was_accepted then
    select requester_id into v_requester_id from ride_requests where id = v_request_id;
    select full_name into v_driver_name from profiles where id = v_driver_id;

    insert into notifications (user_id, type, title, body, ride_request_id)
    values (
      v_requester_id,
      'ride_cancelled',
      'Ride cancelled',
      v_driver_name || ' can no longer give you a ride. ' ||
        case when nullif(trim(p_note), '') is not null then p_note else 'Sorry for the inconvenience.' end ||
        ' It''s been reopened to other neighbors.',
      v_request_id
    );
  end if;
end;
$$;

grant execute on function cancel_ride_offer(uuid, text) to authenticated;

create or replace function cancel_ride_request(p_request_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester_id uuid;
  v_requester_name text;
  v_driver_id uuid;
begin
  select requester_id into v_requester_id from ride_requests where id = p_request_id;

  if v_requester_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  select driver_id into v_driver_id
  from ride_offers
  where ride_request_id = p_request_id and status = 'accepted'
  limit 1;

  update ride_requests
    set status = 'cancelled', cancel_note = nullif(trim(p_note), '')
    where id = p_request_id;

  update ride_offers
    set status = 'cancelled', responded_at = now()
    where ride_request_id = p_request_id
      and status in ('pending', 'accepted');

  if v_driver_id is not null then
    select full_name into v_requester_name from profiles where id = v_requester_id;

    insert into notifications (user_id, type, title, body, ride_request_id)
    values (
      v_driver_id,
      'ride_cancelled',
      'Ride cancelled',
      v_requester_name || ' cancelled this ride request. ' ||
        case when nullif(trim(p_note), '') is not null then p_note else 'Sorry for the inconvenience.' end,
      p_request_id
    );
  end if;
end;
$$;

grant execute on function cancel_ride_request(uuid, text) to authenticated;
