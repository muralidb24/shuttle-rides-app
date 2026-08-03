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

interface EmailResult {
  to: string
  sent: boolean
  error?: string
}

// Returns a result instead of swallowing failures - see notify-neighbors for
// the same pattern and why it matters (a failed send used to be
// indistinguishable from a successful one to anyone outside the function's
// own console logs).
async function sendEmail(to: string, subject: string, html: string): Promise<EmailResult> {
  if (!RESEND_API_KEY) {
    return { to, sent: false, error: 'RESEND_API_KEY is not set' }
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error('Resend error', res.status, errText)
      return { to, sent: false, error: `${res.status} ${errText}` }
    }
    return { to, sent: true }
  } catch (err) {
    console.error('Resend fetch failed', err)
    return { to, sent: false, error: String(err) }
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Destinations are community-configurable now (not a single fixed shuttle
// stop with a known drive time), so there's no basis left for computing a
// derived "leave N minutes early" buffer - the date/time a requester picks
// IS the pickup time, full stop. This just describes *where* the pickup
// happens for the chosen direction: home when heading out, the destination
// itself when heading back. Duplicated from src/lib/format.ts since this
// edge function runs in a separate Deno runtime with no shared import.
function pickupLocationLabel(direction: string, destinationName?: string | null): string {
  if (direction === 'to_shuttle') return 'Pick up from home.'
  return destinationName ? `Pick up from ${destinationName}.` : 'Pick up from the destination.'
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
      '*, ride_request:ride_requests(*, requester:profiles!ride_requests_requester_id_fkey(*), destination:destinations(name)), driver:profiles!ride_offers_driver_id_fkey(*)'
    )
    .eq('status', 'accepted')

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  let sent = 0
  const emailResults: EmailResult[] = []

  for (const offer of offers ?? []) {
    const request = offer.ride_request
    if (!request) continue
    if (request.shuttle_date !== todayStr && request.shuttle_date !== tomorrowStr) continue
    if (offer.last_reminder_sent === todayStr) continue

    const when = request.shuttle_date === todayStr ? 'today' : 'tomorrow'
    const requesterName = request.requester?.full_name ?? 'your neighbor'
    const driverName = offer.driver?.full_name ?? 'your ride giver'
    const guidance = pickupLocationLabel(request.direction, (request.destination as { name: string } | null)?.name)
    const destinationName = (request.destination as { name: string } | null)?.name
    const destinationSuffix = destinationName
      ? request.direction === 'to_shuttle'
        ? ` to ${destinationName}`
        : ` from ${destinationName}`
      : ''

    if (request.requester?.email && request.requester.email_notifications_enabled !== false) {
      const subject = `Reminder: your ride ${when}`
      const html = `<p>This is to remind you that ${driverName} has committed to give you a ride ${when}${destinationSuffix}, at ${request.shuttle_time} on ${request.shuttle_date}.</p><p>${guidance}</p><p><a href="${APP_URL}">Open the app</a> if your plans changed and you need to cancel.</p>`
      emailResults.push(await sendEmail(request.requester.email, subject, html))
      sent += 1
    }

    if (offer.driver?.email && offer.driver.email_notifications_enabled !== false) {
      const subject = `Reminder: you're giving ${requesterName} a ride ${when}`
      const html = `<p>This is to remind you that you've committed to give ${requesterName} a ride ${when}${destinationSuffix}, at ${request.shuttle_time} on ${request.shuttle_date}.</p><p>${guidance}</p><p><a href="${APP_URL}">Open the app</a> if your plans changed and you need to cancel.</p>`
      emailResults.push(await sendEmail(offer.driver.email, subject, html))
      sent += 1
    }

    await supabaseAdmin.from('ride_offers').update({ last_reminder_sent: todayStr }).eq('id', offer.id)
  }

  return new Response(JSON.stringify({ ok: true, reminders_sent: sent, from_email: FROM_EMAIL, email_results: emailResults }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
