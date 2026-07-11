-- In-app notifications + per-user email opt-out.
-- Already applied directly to the live project via the Supabase MCP connector;
-- kept here so `supabase db push` stays in sync for anyone re-provisioning.

alter table profiles add column if not exists email_notifications_enabled boolean not null default true;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('ride_requested','ride_accepted','ride_declined','ride_cancelled')),
  title text not null,
  body text not null,
  ride_request_id uuid references ride_requests(id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on notifications (user_id, read, created_at desc);

alter table notifications enable row level security;

create policy "users read their own notifications"
  on notifications for select
  to authenticated
  using (user_id = auth.uid());

create policy "users mark their own notifications read"
  on notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- accept_ride_offer / cancel_ride_offer / cancel_ride_request are redefined
-- here to also write a notification row for the counterpart. See
-- 0001_init.sql for the original bodies these replace.

create or replace function accept_ride_offer(p_offer_id uuid)
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
begin
  select ride_request_id, driver_id into v_request_id, v_driver_id
  from ride_offers where id = p_offer_id;

  if v_driver_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  update ride_offers
    set status = 'accepted', responded_at = now()
    where id = p_offer_id;

  update ride_offers
    set status = 'declined', responded_at = now()
    where ride_request_id = v_request_id
      and id <> p_offer_id
      and status = 'pending';

  update ride_requests
    set status = 'matched'
    where id = v_request_id;

  select requester_id into v_requester_id from ride_requests where id = v_request_id;
  select full_name into v_driver_name from profiles where id = v_driver_id;

  insert into notifications (user_id, type, title, body, ride_request_id)
  values (
    v_requester_id,
    'ride_accepted',
    'Ride confirmed',
    v_driver_name || ' will give you a ride.',
    v_request_id
  );
end;
$$;

grant execute on function accept_ride_offer(uuid) to authenticated;

create or replace function cancel_ride_offer(p_offer_id uuid)
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
    set status = 'cancelled', responded_at = now()
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
      v_driver_name || ' can no longer give you a ride. It''s been reopened to other neighbors.',
      v_request_id
    );
  end if;
end;
$$;

grant execute on function cancel_ride_offer(uuid) to authenticated;

create or replace function cancel_ride_request(p_request_id uuid)
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
    set status = 'cancelled'
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
      v_requester_name || ' cancelled this ride request.',
      p_request_id
    );
  end if;
end;
$$;

grant execute on function cancel_ride_request(uuid) to authenticated;
