-- Enables pg_net so Postgres can make outbound HTTP calls directly (used
-- here to invoke the notify-neighbors edge function from SQL for
-- diagnostics, without needing to go through the frontend or an external
-- HTTP client). Harmless to have enabled generally.

create extension if not exists pg_net with schema extensions;
