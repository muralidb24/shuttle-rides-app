-- Neighborhood shuttle rides: initial schema
-- Run this in the Supabase SQL editor, or via `supabase db push`.

create extension if not exists "pgcrypto";

-- One row per signed-in user, created lazily on first login by the app.
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null,
  calendar_integrated boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists ride_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles (id) on delete cascade,
  direction text not null check (direction in ('to_shuttle', 'from_shuttle')),
  shuttle_date date not null,
  shuttle_time time not null,
  status text not null default 'open' check (status in ('open', 'matched', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists ride_offers (
  id uuid primary key default gen_random_uuid(),
  ride_request_id uuid not null references ride_requests (id) on delete cascade,
  driver_id uuid not null references profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  calendar_added boolean not null default false,
  reminder_opt_in boolean not null default true,
  last_reminder_sent date,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (ride_request_id, driver_id)
);

create index if not exists ride_offers_driver_idx on ride_offers (driver_id, status);
create index if not exists ride_requests_requester_idx on ride_requests (requester_id, status);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;
alter table ride_requests enable row level security;
alter table ride_offers enable row level security;

-- Profiles: everyone in the community can see everyone else's name (needed to
-- render "driving Alex Chen" etc.), but you can only edit your own row.
create policy "profiles are readable by any signed-in neighbor"
  on profiles for select
  to authenticated
  using (true);

create policy "users manage their own profile"
  on profiles for insert
  to authenticated
  with check (id = auth.uid());

create policy "users update their own profile"
  on profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Ride requests: visible to any signed-in neighbor (so the requester's name and
-- ride details can be shown on other people's "pending ask" cards); only the
-- requester can create/modify their own request directly (cancellation goes
-- through the cancel_ride_request() function below for the compound update).
create policy "ride requests are readable by any signed-in neighbor"
  on ride_requests for select
  to authenticated
  using (true);

create policy "requesters create their own ride requests"
  on ride_requests for insert
  to authenticated
  with check (requester_id = auth.uid());

-- Ride offers: a user can see an offer if they're the driver being asked, or
-- the requester who owns the underlying ride request.
create policy "offers are readable by driver or requester"
  on ride_offers for select
  to authenticated
  using (
    driver_id = auth.uid()
    or exists (
      select 1 from ride_requests rr
      where rr.id = ride_offers.ride_request_id
        and rr.requester_id = auth.uid()
    )
  );

-- Offer rows are fanned out server-side by the notify-neighbors edge function
-- (using the service role key, which bypasses RLS), so there is no public
-- insert policy here.

create policy "drivers update their own offers"
  on ride_offers for update
  to authenticated
  using (driver_id = auth.uid())
  with check (driver_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Functions: compound state transitions that need to touch more than one row
-- atomically, run with the privileges of the function owner (service role).
-- ---------------------------------------------------------------------------

create or replace function accept_ride_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_driver_id uuid;
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
begin
  select ride_request_id, driver_id into v_request_id, v_driver_id
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
begin
  select requester_id into v_requester_id from ride_requests where id = p_request_id;

  if v_requester_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  update ride_requests
    set status = 'cancelled'
    where id = p_request_id;

  update ride_offers
    set status = 'cancelled', responded_at = now()
    where ride_request_id = p_request_id
      and status in ('pending', 'accepted');
end;
$$;

grant execute on function cancel_ride_request(uuid) to authenticated;
