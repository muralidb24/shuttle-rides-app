-- Small neighborhood communities have no real trust boundary between
-- members - everyone already knows each other IRL - and "admin" here only
-- ever unlocks low-stakes things: renaming the community, changing the join
-- code, managing destinations, and promoting/demoting members. Nothing
-- destructive (no member removal, no community deletion). Given that,
-- requiring a single admin is a pure liability: if that one person moves
-- away without transferring admin, or simply stops using the app, the
-- whole community is stuck with no way to manage itself. Making every
-- member an admin removes that single point of failure entirely.

-- 1. New members join as admins from now on (create_community_and_join
-- already makes the creator an admin - no change needed there).
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
  values (auth.uid(), v_email, trim(p_full_name), v_community_id, 'admin');

  return query select * from profiles where id = auth.uid();
end;
$$;

-- 2. Promote everyone already in the app too, so existing communities get
-- the same protection without anyone having to manually promote each other.
-- The governance-protection trigger is only meant to stop *client-side*
-- role changes bypassing set_member_role() - temporarily disable it for
-- this one-time bulk backfill, then re-enable immediately after.
alter table profiles disable trigger profiles_protect_governance_fields;
update profiles set role = 'admin' where role <> 'admin';
alter table profiles enable trigger profiles_protect_governance_fields;

-- 3. Guard the one gap "everyone admin" doesn't already close on its own:
-- nothing currently stops the last remaining admin in a community (or,
-- today, a lone admin) from being demoted - accidentally or otherwise -
-- which would leave that community with zero admins and no way back in
-- via the app. Block that specific case; every other admin action (and
-- demoting a member down when other admins remain) is unaffected.
create or replace function set_member_role(p_member_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_community_id uuid;
  v_admin_count int;
  v_target_is_admin boolean;
begin
  if p_role not in ('member', 'admin') then
    raise exception 'invalid role';
  end if;
  if not is_admin() then
    raise exception 'not authorized';
  end if;

  v_community_id := current_community_id();

  select role = 'admin' into v_target_is_admin
    from profiles where id = p_member_id and community_id = v_community_id;

  if p_role = 'member' and v_target_is_admin then
    select count(*) into v_admin_count
      from profiles where community_id = v_community_id and role = 'admin';
    if v_admin_count <= 1 then
      raise exception 'cannot remove the last admin in a community';
    end if;
  end if;

  update profiles
    set role = p_role
    where id = p_member_id
      and community_id = v_community_id;
end;
$$;
