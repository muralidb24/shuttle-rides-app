-- Support self-service account deletion (e.g. a neighbor moving away).
-- Two things are needed:
--
-- 1. notifications.related_user_id currently has no ON DELETE behavior
--    (NO ACTION), which means it would block deleting a profiles row
--    whenever some OTHER user's notification still references the
--    departing user as the "related" party (e.g. "Jane will give you a
--    ride" notifications sent to a requester, with related_user_id set to
--    the driver). Fix it the same way default_destination_id already
--    handles an optional reference to something that might disappear:
--    just drop the reference gracefully.
alter table notifications drop constraint notifications_related_user_id_fkey;
alter table notifications add constraint notifications_related_user_id_fkey
  foreign key (related_user_id) references profiles(id) on delete set null;

-- 2. Before a departing member's account is actually deleted, gracefully
-- wind down anything they're currently on the hook for - mirroring exactly
-- what cancel_ride_offer/cancel_ride_request already do when a person
-- cancels manually (reopen/cancel the ride, notify the other side) - so
-- nobody is left silently stuck by someone who simply vanished. Everything
-- else (their own past ride history, push tokens, etc.) is left to the
-- existing ON DELETE CASCADE chain from auth.users once the account itself
-- is deleted via the Admin API.
create or replace function prepare_account_for_deletion()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_my_id uuid := auth.uid();
  v_my_name text;
  r record;
begin
  select full_name into v_my_name from profiles where id = v_my_id;

  -- Rides I'm currently committed to give: cancel and reopen, and let the
  -- requester know, same as a manual cancel would.
  for r in
    select o.id as offer_id, o.ride_request_id, rr.requester_id, rr.shuttle_date, rr.shuttle_time
    from ride_offers o
    join ride_requests rr on rr.id = o.ride_request_id
    where o.driver_id = v_my_id and o.status = 'accepted'
  loop
    update ride_offers set status = 'cancelled', responded_at = now() where id = r.offer_id;
    update ride_requests set status = 'open' where id = r.ride_request_id;
    insert into notifications (user_id, type, title, body, ride_request_id)
    values (
      r.requester_id,
      'ride_cancelled',
      'Ride cancelled',
      coalesce(v_my_name, 'Your ride giver') || ' can no longer give you a ride at ' || r.shuttle_time || ' on ' ||
        r.shuttle_date || '. They''ve left the community. It''s been reopened to other neighbors.',
      r.ride_request_id
    );
  end loop;

  -- Rides I've requested that are still open or matched: cancel them, and
  -- if someone had already committed to driving, let them know.
  for r in
    select rr.id as request_id, rr.shuttle_date, rr.shuttle_time,
      (select o.driver_id from ride_offers o where o.ride_request_id = rr.id and o.status = 'accepted' limit 1) as driver_id
    from ride_requests rr
    where rr.requester_id = v_my_id and rr.status in ('open', 'matched')
  loop
    update ride_requests set status = 'cancelled' where id = r.request_id;
    update ride_offers set status = 'cancelled', responded_at = now()
      where ride_request_id = r.request_id and status in ('pending', 'accepted');

    if r.driver_id is not null then
      insert into notifications (user_id, type, title, body, ride_request_id)
      values (
        r.driver_id,
        'ride_cancelled',
        'Ride cancelled',
        coalesce(v_my_name, 'Your neighbor') || ' cancelled the ride request for ' || r.shuttle_time || ' on ' ||
          r.shuttle_date || '. They''ve left the community.',
        r.request_id
      );
    end if;
  end loop;
end;
$$;

grant execute on function prepare_account_for_deletion() to authenticated;
