-- Requires explicit acceptance of the Terms of Use (public/terms.html) as
-- part of onboarding, rather than relying on a passive menu link that
-- nobody's actually required to open. Recorded with a timestamp so there's
-- a record of when each member agreed.
--
-- Existing members (who joined before this existed) are left with a null
-- terms_accepted_at - there's no good way to retroactively obtain their
-- consent, and forcing a re-gate on their next login is a separate product
-- decision this migration doesn't make.

alter table profiles add column if not exists terms_accepted_at timestamptz;

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
  values (auth.uid(), v_email, trim(p_full_name), v_community_id, 'member', now());

  return query select * from profiles where id = auth.uid();
end;
$$;
grant execute on function join_community(text, text, boolean) to authenticated;

create or replace function create_community_and_join(p_name text, p_join_code text, p_full_name text, p_terms_accepted boolean)
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

  insert into communities (name, join_code, created_by)
  values (trim(p_name), trim(p_join_code), auth.uid())
  returning id into v_community_id;

  select email into v_email from auth.users where id = auth.uid();

  insert into profiles (id, email, full_name, community_id, role, terms_accepted_at)
  values (auth.uid(), v_email, trim(p_full_name), v_community_id, 'admin', now());

  return query select * from profiles where id = auth.uid();
end;
$$;
grant execute on function create_community_and_join(text, text, text, boolean) to authenticated;

-- Old 2-arg / 3-arg overloads are superseded by the versions above (which
-- add a required p_terms_accepted argument) - drop them outright rather
-- than leaving dead, misleading overloads reachable via PostgREST.
drop function if exists join_community(text, text);
drop function if exists create_community_and_join(text, text, text);
