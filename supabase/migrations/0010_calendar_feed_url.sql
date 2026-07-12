-- Real calendar availability checking, via a private iCal/ICS feed URL
-- rather than Google OAuth (no consent screen / token refresh to maintain,
-- and it works the same for Google, Outlook, and Apple Calendar since they
-- all expose a "secret address in iCal format").

alter table profiles add column if not exists calendar_feed_url text;
