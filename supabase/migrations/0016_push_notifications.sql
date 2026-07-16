-- Push notification support: a table to hold each device's FCM registration
-- token, plus a trigger that fires a push for every notification row the app
-- already creates today (ride requested / accepted / declined / cancelled).
--
-- Centralizing on an AFTER INSERT trigger on `notifications` means every
-- existing notification-creation site - the notify-neighbors edge function
-- AND the accept_ride_offer / cancel_ride_offer / cancel_ride_request SQL
-- RPCs - gets push delivery for free, with no changes needed to any of them.
-- This mirrors the pg_cron -> net.http_post pattern already used for
-- reminder emails (0012_pg_cron_reminder_trigger.sql).

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (token)
);

create index push_tokens_user_idx on push_tokens (user_id);

alter table push_tokens enable row level security;

create policy "users manage their own push tokens"
  on push_tokens
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Re-registering the same device (token) just re-points it at whichever
-- profile is currently signed in and refreshes updated_at - handles the
-- device-changes-owner case (e.g. a shared family tablet) without needing a
-- separate upsert RPC.

-- Trigger function: fires the send-push edge function via pg_net whenever a
-- new notification row is inserted, regardless of which code path created
-- it. Reuses the same `cron_secret` Vault entry already set up for the
-- reminder-email trigger as a general internal-service auth token - no new
-- secret to configure. If it isn't set yet, this is a harmless no-op.
create or replace function trigger_send_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_secret'
  limit 1;

  if v_secret is null then
    raise notice 'cron_secret not set in Vault yet - skipping send-push trigger';
    return new;
  end if;

  perform net.http_post(
    url := 'https://gbgzyghfnhfppsobjaez.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('notification_id', new.id)
  );

  return new;
end;
$$;

create trigger notifications_send_push
  after insert on notifications
  for each row
  execute function trigger_send_push();
