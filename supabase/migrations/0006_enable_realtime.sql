-- The app subscribes to postgres_changes on ride_requests, ride_offers, and
-- notifications so an open dashboard updates live (e.g. a new ride request
-- shows up under "Needs your response" without a refresh). None of these
-- tables were ever added to the supabase_realtime publication, so those
-- subscriptions were silently never firing - the only signal users got was
-- the email. This adds all three tables to the publication.

alter publication supabase_realtime add table ride_requests;
alter publication supabase_realtime add table ride_offers;
alter publication supabase_realtime add table notifications;
