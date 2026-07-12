// Edge function: sends "ride tomorrow" / "ride today" reminder emails to both
// the driver and the requester on every matched ride. Meant to be triggered
// once a day by a GitHub Actions cron workflow (see
// .github/workflows/reminders.yml), not by the frontend.
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

function subtractMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m - minutes
  const wrapped = ((total % 1440) + 1440) % 1440
  const hh = Math.floor(wrapped / 60)
  const mm = wrapped % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// Riders only give the shuttle date/time - work out pickup guidance from
// direction + that time (10-min shuttle, so a 15-min-early pickup covers it).
function pickupGuidance(direction: string, shuttleTime: string): string {
  if (direction === 'to_shuttle') {
    const pickup = subtractMinutes(shuttleTime, 15)
    return `Pick up from home around ${pickup} - about 15 minutes before the ${shuttleTime} shuttle.`
  }
  return `Be at the shuttle stop by ${shuttleTime}.`
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

  // Reminders go to both parties on every matched ride happening today or
  // tomorrow, regardless of calendar-sync status - calendar sync only
  // controls whether the app also nudges the driver to add the event to
  // their own calendar, not whether they get a reminder email.
  const { data: offers, error } = await supabaseAdmin
    .from('ride_offers')
    .select(
      '*, ride_request:ride_requests(*, requester:profiles!ride_requests_requester_id_fkey(*)), driver:profiles!ride_offers_driver_id_fkey(*)'
    )
    .eq('status', 'accepted')

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  let sent = 0

  for (const offer of offers ?? []) {
    const request = offer.ride_request
    if (!request) continue
    if (request.shuttle_date !== todayStr && request.shuttle_date !== tomorrowStr) continue
    if (offer.last_reminder_sent === todayStr) continue

    const when = request.shuttle_date === todayStr ? 'today' : 'tomorrow'
    const requesterName = request.requester?.full_name ?? 'your neighbor'
    const driverName = offer.driver?.full_name ?? 'your ride giver'
    const guidance = pickupGuidance(request.direction, request.shuttle_time)

    if (request.requester?.email && request.requester.email_notifications_enabled !== false) {
      const subject = `Reminder: your ride ${when}`
      const html = `<p>This is a reminder that ${driverName} is giving you a ride ${when}, ${request.shuttle_date} for the ${request.shuttle_time} shuttle.</p><p>${guidance}</p><p><a href="${APP_URL}">Open the app</a> if your plans changed and you need to cancel.</p>`
      await sendEmail(request.requester.email, subject, html)
      sent += 1
    }

    if (offer.driver?.email && offer.driver.email_notifications_enabled !== false) {
      const subject = `Reminder: you're giving ${requesterName} a ride ${when}`
      const html = `<p>This is a reminder that you're giving ${requesterName} a ride ${when}, ${request.shuttle_date} for the ${request.shuttle_time} shuttle.</p><p>${guidance}</p><p><a href="${APP_URL}">Open the app</a> if your plans changed and you need to cancel.</p>`
      await sendEmail(offer.driver.email, subject, html)
      sent += 1
    }

    await supabaseAdmin.from('ride_offers').update({ last_reminder_sent: todayStr }).eq('id', offer.id)
  }

  return new Response(JSON.stringify({ ok: true, reminders_sent: sent }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
