// Edge function: sends "ride tomorrow" / "ride today" reminder emails to
// drivers who accepted a ride but chose not to have it added to their
// calendar. Meant to be triggered once a day by a GitHub Actions cron
// workflow (see .github/workflows/reminders.yml), not by the frontend.
//
// Deploy: supabase functions deploy send-reminders --no-verify-jwt
// Secrets needed (supabase secrets set ...):
//   RESEND_API_KEY, FROM_EMAIL, APP_URL  (same as notify-neighbors)
//   CRON_SECRET  - a random string; the caller must send it as
//                  `Authorization: Bearer <CRON_SECRET>`
//
// Note: "today" / "tomorrow" are computed in UTC. For a single-neighborhood
// app this is usually fine to run at a fixed UTC hour that lands in the
// morning locally; adjust the cron schedule in reminders.yml for your
// timezone if needed.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'rides@example.com'
const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:5173'
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set - skipping email send to', to)
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
  })
  if (!res.ok) {
    console.error('Resend error', await res.text())
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  const today = new Date()
  const todayStr = isoDate(today)
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
  const tomorrowStr = isoDate(tomorrow)

  const { data: offers, error } = await supabaseAdmin
    .from('ride_offers')
    .select('*, ride_request:ride_requests(*, requester:profiles!ride_requests_requester_id_fkey(*)), driver:profiles!ride_offers_driver_id_fkey(*)')
    .eq('status', 'accepted')
    .eq('calendar_added', false)
    .eq('reminder_opt_in', true)
    .in('ride_request.shuttle_date', [todayStr, tomorrowStr])

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  let sent = 0

  for (const offer of offers ?? []) {
    const request = offer.ride_request
    if (!request) continue
    // The `in` filter above applies at the top level for embedded resources in
    // some client versions; double check here so we never mail the wrong day.
    if (request.shuttle_date !== todayStr && request.shuttle_date !== tomorrowStr) continue
    if (offer.last_reminder_sent === todayStr) continue

    const when = request.shuttle_date === todayStr ? 'today' : 'tomorrow'
    const requesterName = request.requester?.full_name ?? 'your neighbor'
    const direction = request.direction === 'to_shuttle' ? 'to the shuttle' : 'from the shuttle'

    const subject = `Reminder: you're driving ${requesterName} ${when}`
    const html = `<p>This is a reminder that you're giving ${requesterName} a ride ${direction} ${when}, ${request.shuttle_date} at ${request.shuttle_time}.</p><p><a href="${APP_URL}">Open the app</a> if your plans changed and you need to cancel.</p>`

    await sendEmail(offer.driver?.email, subject, html)

    await supabaseAdmin.from('ride_offers').update({ last_reminder_sent: todayStr }).eq('id', offer.id)
    sent += 1
  }

  return new Response(JSON.stringify({ ok: true, reminders_sent: sent }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
