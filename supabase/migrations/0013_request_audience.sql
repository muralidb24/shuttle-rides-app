-- Lets a requester control who their own ride requests get sent to:
-- everyone (default, current behavior), everyone except some selected
-- neighbors, or only some selected neighbors. This is a persistent
-- per-user setting (like calendar sync), applied by notify-neighbors to
-- every future request that user creates - not a per-request choice.

alter table profiles add column if not exists request_audience_mode text not null default 'everyone'
  check (request_audience_mode in ('everyone', 'all_except', 'only'));

-- One row per (requester, selected neighbor). The same table backs both
-- 'all_except' (rows are exclusions) and 'only' (rows are the sole
-- audience) - request_audience_mode on the requester's profile determines
-- how the rows are interpreted at fan-out time.
create table if not exists request_audience_members (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  member_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (requester_id, member_id)
);

create index if not exists request_audience_members_requester_idx on request_audience_members (requester_id);

alter table request_audience_members enable row level security;

-- Purely a private preference - only the requester who owns it ever needs
-- to read or write these rows. (notify-neighbors reads it server-side with
-- the service role key, which bypasses RLS entirely.)
create policy "users manage their own audience selections"
  on request_audience_members for all
  to authenticated
  using (requester_id = auth.uid())
  with check (requester_id = auth.uid());
