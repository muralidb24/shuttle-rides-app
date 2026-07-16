-- Multi-community support: every profile belongs to exactly one community,
-- with either 'member' or 'admin' role. New users either join an existing
-- community via a join code or create a new one (becoming its first admin
-- automatically). Existing live users are backfilled into a single
-- retroactively-created community below so nothing breaks for them.

create table if not exists communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null,
  -- References auth.users rather than profiles: the creator's profiles row
  -- doesn't exist yet at the point create_community_and_join() inserts this
  -- row (profile creation needs this row's id first), but their auth.users
  -- row already does (created at magic-link sign-in).
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness: codes are stored with whatever casing the
-- creator typed (for friendlier display) but compared case-insensitively
-- everywhere, so "abc123" and "ABC123" can't both exist and a joiner isn't
-- tripped up by case when typing one in.
create unique index if not exists communities_join_code_upper_idx on communities (upper(join_code));

alter table communities enable row level security;

alter table profiles add column if not exists community_id uuid references communities(id);
alter table profiles add column if not exists role text not null default 'member' check (role in ('member', 'admin'));

-- ---------------------------------------------------------------------------
-- Backfill: retroactively group today's existing users into one community,
-- with the account that requested this migration as its sole initial admin.
-- ---------------------------------------------------------------------------
do $$
declare
  v_community_id uuid;
  v_admin_id uuid;
begin
  select id into v_admin_id from profiles where email = 'muralidb24@gmail.com';

  insert into communities (name, join_code, created_by)
  values ('Montage Logan Express Ride', 'MontageLExRide', v_admin_id)
  returning id into v_community_id;

  update profiles set community_id = v_community_id;
  update profiles set role = 'admin' where id = v_admin_id;
end;
$$;

alter table profiles alter column community_id set not null;

-- ---------------------------------------------------------------------------
-- Helper functions used by RLS policies below. SECURITY DEFINER + owned by
-- the migration-applying role (which owns profiles/communities and so
-- bypasses their RLS), so these can look up the caller's own community/role
-- without recursing back through the very policies they gate.
-- ---------------------------------------------------------------------------

create or replace function current_community_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select community_id from profiles where id = auth.uid()
$$;

create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------------
-- Tighten profiles RLS to the caller's own community, and protect the
-- governance columns (role, community_id) from being changed via a direct
-- client-side update - both must only ever change through the security
-- definer functions below, never through the general
-- "users update their own profile" policy (whose USING/WITH CHECK only
-- verifies row ownership, not which columns are being changed - without
-- this, any signed-in user could self-promote to admin or hop into another
-- community with a plain client-side update() call).
-- ---------------------------------------------------------------------------

drop policy if exists "profiles are readable by any signed-in neighbor" on profiles;
create policy "profiles are readable by same-community neighbors"
  on profiles for select
  to authenticated
  using (community_id = current_community_id());

-- The original insert policy is dropped - profile creation now exclusively
-- goes through join_community()/create_community_and_join() below, which
-- run as the function owner and so don't need a client-facing insert
-- policy at all (and deliberately isn't given one: a direct client insert
-- could otherwise set role='admin' or an arbitrary community_id).
drop policy if exists "users manage their own profile" on profiles;

create or replace function protect_profile_governance_fields()
returns trigger
language plpgsql
as $$
begin
  -- current_user differs from session_user only inside a SECURITY DEFINER
  -- function running as a different owner - i.e. only the trusted RPCs
  -- below, never a direct client update (which always runs as the
  -- authenticated session's own role, where current_user = session_user).
  if current_user = session_user then
    if new.role is distinct from old.role then
      raise exception 'role can only be changed via set_member_role()';
    end if;
    if new.community_id is distinct from old.community_id then
      raise exception 'community_id cannot be changed directly';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_governance_fields on profiles;
create trigger profiles_protect_governance_fields
  before update on profiles
  for each row execute function protect_profile_governance_fields();

-- ---------------------------------------------------------------------------
-- ride_requests: scope visibility to the requester's community.
-- ---------------------------------------------------------------------------

drop policy if exists "ride requests are readable by any signed-in neighbor" on ride_requests;
create policy "ride requests are readable by same-community neighbors"
  on ride_requests for select
  to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.id = ride_requests.requester_id
        and p.community_id = current_community_id()
    )
  );

-- ---------------------------------------------------------------------------
-- communities: no direct insert policy (only via the RPCs below, which run
-- as owner). Members can read their own community's row; admins can update
-- it (rename, change join code).
-- ---------------------------------------------------------------------------

create policy "members read their own community"
  on communities for select
  to authenticated
  using (id = current_community_id());

create policy "admins update their own community"
  on communities for update
  to authenticated
  using (id = current_community_id() and is_admin())
  with check (id = current_community_id() and is_admin());

-- ---------------------------------------------------------------------------
-- Onboarding RPCs: the only paths that can create a profiles or
-- communities row from the client.
-- ---------------------------------------------------------------------------

create or replace function lookup_community_by_code(p_code text)
returns table(id uuid, name text)
language sql
security definer
stable
set search_path = public
as $$
  select id, name from communities where upper(join_code) = upper(trim(p_code))
$$;
grant execute on function lookup_community_by_code(text) to authenticated;

create or replace function join_community(p_join_code text, p_full_name text)
returns setof profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_community_id uuid;
  v_email text;
begin
  select id into v_community_id from communities where upper(join_code) = upper(trim(p_join_code));
  if v_community_id is null then
    raise exception 'invalid join code';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into profiles (id, email, full_name, community_id, role)
  values (auth.uid(), v_email, trim(p_full_name), v_community_id, 'member');

  return query select * from profiles where id = auth.uid();
end;
$$;
grant execute on function join_community(text, text) to authenticated;

create or replace function create_community_and_join(p_name text, p_join_code text, p_full_name text)
returns setof profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_community_id uuid;
  v_email text;
begin
  insert into communities (name, join_code, created_by)
  values (trim(p_name), trim(p_join_code), auth.uid())
  returning id into v_community_id;

  select email into v_email from auth.users where id = auth.uid();

  insert into profiles (id, email, full_name, community_id, role)
  values (auth.uid(), v_email, trim(p_full_name), v_community_id, 'admin');

  return query select * from profiles where id = auth.uid();
end;
$$;
grant execute on function create_community_and_join(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin action: promote/demote a member within their own community. The
-- only path by which role can ever change post-signup.
-- ---------------------------------------------------------------------------

create or replace function set_member_role(p_member_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_role not in ('member', 'admin') then
    raise exception 'invalid role';
  end if;
  if not is_admin() then
    raise exception 'not authorized';
  end if;

  update profiles
    set role = p_role
    where id = p_member_id
      and community_id = current_community_id();
end;
$$;
grant execute on function set_member_role(uuid, text) to authenticated;
