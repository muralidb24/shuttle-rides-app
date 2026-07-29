-- Generalizes the app's previously-implicit single destination (the airport
-- shuttle stop) into a community-defined list. Each community's admin can
-- define its own set of popular destinations; each member can optionally set
-- a personal default; each ride request records which destination it's for
-- so ride givers know where they're actually going.

create table destinations (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (community_id, name)
);

alter table destinations enable row level security;

create policy "members read community destinations"
  on destinations for select
  using (community_id = current_community_id());

create policy "admins insert community destinations"
  on destinations for insert
  with check (community_id = current_community_id() and is_admin());

create policy "admins update community destinations"
  on destinations for update
  using (community_id = current_community_id() and is_admin())
  with check (community_id = current_community_id() and is_admin());

create policy "admins delete community destinations"
  on destinations for delete
  using (community_id = current_community_id() and is_admin());

-- Optional personal default - nullable, and set to null (not cascaded to
-- deleting the profile) if the chosen destination is later removed.
alter table profiles add column if not exists default_destination_id uuid references destinations(id) on delete set null;

-- Every ride request needs a destination so ride givers know where to go.
-- Added nullable first so the backfill below can populate existing rows,
-- then locked to not null afterward. No ON DELETE clause (defaults to
-- RESTRICT) - an admin can't delete a destination that's still referenced by
-- a live ride request; since requests auto-expire ~1hr after their shuttle
-- time (see 0011), this is a narrow, self-resolving edge case rather than a
-- permanent block.
alter table ride_requests add column if not exists destination_id uuid references destinations(id);

-- Backfill: every existing community gets one destination seeded from what
-- was previously hardcoded/implicit, all current members get it as their
-- default, and all existing ride requests get pointed at it.
do $$
declare
  v_community_id uuid;
  v_destination_id uuid;
begin
  for v_community_id in select id from communities loop
    insert into destinations (community_id, name)
    values (v_community_id, 'Airport Shuttle Stop')
    returning id into v_destination_id;

    update profiles
    set default_destination_id = v_destination_id
    where community_id = v_community_id;

    update ride_requests
    set destination_id = v_destination_id
    where destination_id is null
      and requester_id in (select id from profiles where community_id = v_community_id);
  end loop;
end $$;

alter table ride_requests alter column destination_id set not null;
