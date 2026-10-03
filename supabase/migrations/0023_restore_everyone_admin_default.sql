-- 0022_terms_acceptance.sql rewrote join_community() wholesale to add the
-- p_terms_accepted parameter, and in doing so silently reverted the role it
-- inserts from 'admin' back to 'member' - undoing 0020_everyone_admin_by_
-- default.sql from a month earlier without anyone intending to. Net effect:
-- every member who joined an existing community (as opposed to creating
-- one) between 0022 and this fix landed as a plain 'member' and lost
-- access to Community settings, which is gated on role = 'admin'.
--
-- This restores the 0020 behavior - new joiners are admins, same as
-- everyone else - and backfills anyone who joined in the affected window
-- back up to 'admin', the same way 0020's own one-time backfill did.

create or replace function join_community(p_join_code text, p_full_name text, p_terms_accepted boolean)
returns setof profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_community_id uuid;
  v_email text;
begin
  if not p_terms_accepted then
    raise exception 'terms of use must be accepted';
  end if;

  select id into v_community_id from communities where upper(join_code) = upper(trim(p_join_code));
  if v_community_id is null then
    raise exception 'invalid join code';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into profiles (id, email, full_name, community_id, role, terms_accepted_at)
  values (auth.uid(), v_email, trim(p_full_name), v_community_id, 'admin', now());

  return query select * from profiles where id = auth.uid();
end;
$$;
grant execute on function join_community(text, text, boolean) to authenticated;

-- Backfill: same pattern as 0020's one-time bulk promotion, disabling the
-- client-side-change guard trigger only for this statement.
alter table profiles disable trigger profiles_protect_governance_fields;
update profiles set role = 'admin' where role <> 'admin';
alter table profiles enable trigger profiles_protect_governance_fields;
