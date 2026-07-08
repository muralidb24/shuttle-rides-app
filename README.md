# Neighborhood shuttle rides

Coordinates rides to and from the community's airport shuttle stop: request a
ride in either direction, neighbors get asked (via the app and email), the
first to accept is committed, and either side can cancel later.

Stack: React + Vite (frontend), Supabase (Postgres, Auth, Edge Functions),
Resend (email), GitHub Actions + GitHub Pages (hosting).

## How the pieces map to the spec

| Behavior | Where it lives |
|---|---|
| Magic-link login | Supabase Auth `signInWithOtp`, emailed via Resend SMTP |
| Request a ride, either direction | `ride_requests` table, `src/pages/RequestRide.tsx` |
| Ask every neighbor when a request comes in | `supabase/functions/notify-neighbors` |
| Calendar-integrated -> auto availability check | `checkCalendarAvailability` stub in `src/lib/calendar.ts` and the edge function's `isAvailable` — see note below |
| Not integrated -> explicit availability/willingness prompt | `src/components/PendingAskCard.tsx` |
| Offer to add accepted ride to calendar | `src/components/CalendarPrompt.tsx` (Google Calendar link + .ics download) |
| Email reminders day-before/day-of if not added to calendar | `supabase/functions/send-reminders`, triggered daily by `.github/workflows/reminders.yml` |
| List of committed rides / requested rides | `src/pages/Dashboard.tsx` |
| Cancel from either side | Cancel buttons on both lists, backed by `cancel_ride_offer` / `cancel_ride_request` |

**Calendar integration is a stub, by design.** Auto-checking a homeowner's real
free/busy status needs a full OAuth integration per calendar provider (consent
screen, token storage/refresh, a Free/Busy API call) — a project on its own.
The `calendar_integrated` flag and branching logic are fully wired up (toggle
it from the dashboard to see both flows), but `isAvailable()` currently always
returns true. Swap that one function for a real Google Calendar API call when
you're ready to build that piece; nothing else needs to change.

## One-time setup

### 1. Supabase project

1. Create a project at supabase.com.
2. In the SQL editor, run `supabase/migrations/0001_init.sql`.
3. Under Authentication -> URL Configuration, add your GitHub Pages URL (e.g.
   `https://<you>.github.io/<repo>/`) as a redirect URL.
4. Under Authentication -> Emails -> SMTP Settings, turn on "custom SMTP" and
   point it at Resend so magic-link emails send through Resend:
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: your Resend API key
   - Sender email: an address on a domain you've verified in Resend

### 2. Resend

1. Create an account at resend.com and verify a sending domain.
2. Create an API key.
3. Use that key both in Supabase's SMTP settings (step above) and as the
   `RESEND_API_KEY` secret for edge functions (step below) — the first sends
   auth emails, the second sends ride-notification and reminder emails.

### 3. Edge functions

With the Supabase CLI (`npm i -g supabase`, then `supabase login` and
`supabase link --project-ref <your-ref>`):

```
supabase secrets set RESEND_API_KEY=re_xxx FROM_EMAIL=rides@yourdomain.com APP_URL=https://<you>.github.io/<repo>/ CRON_SECRET=$(openssl rand -hex 20)
supabase functions deploy notify-neighbors
supabase functions deploy send-reminders --no-verify-jwt
```

Note the `CRON_SECRET` value — you'll need it for the GitHub Actions secret
below.

### 4. GitHub repository

1. Push this project to a new GitHub repo.
2. Under Settings -> Pages, set Source to "GitHub Actions".
3. Under Settings -> Secrets and variables -> Actions, add:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (Project Settings -> API)
   - `SUPABASE_FUNCTIONS_URL` — `https://<your-ref>.supabase.co/functions/v1`
   - `CRON_SECRET` — the same value you set in step 3
4. Push to `main` (or run the "Deploy to GitHub Pages" workflow manually) to
   build and publish the site. The "Send ride reminders" workflow runs daily
   on its own schedule.

## Local development

```
cp .env.example .env   # fill in your Supabase project URL + anon key
npm install
npm run dev
```

## Path to a native mobile app

This is a good foundation for that: all the real logic lives in Supabase
(auth, database, edge functions), and the React frontend only talks to
Supabase over its JS client / HTTP — nothing here is web-only. The
straightforward route later is wrapping this same frontend with
[Capacitor](https://capacitorjs.com) to ship it as an iOS/Android app with
minimal changes:

- The magic-link redirect (`emailRedirectTo`) would need to point at a custom
  URL scheme / universal link instead of a web URL — Supabase supports this.
- Push notifications (instead of/alongside email) for new ride requests would
  be a natural upgrade once wrapped natively.
- The calendar "add to calendar" step could switch from a Google Calendar web
  link to the native calendar APIs Capacitor exposes.

None of that blocks testing the web version now — it's just worth knowing the
current structure doesn't need a rewrite to get there.
