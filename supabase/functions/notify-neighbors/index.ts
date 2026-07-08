// Edge function: fans a new ride request out to every other neighbor and emails
// them. Invoked by the client (with the requester's JWT) right after a ride
// request is inserted — see src/lib/api.ts `createRideRequest`.
//
// Deploy: supabase functions deploy notify-neighbors
// Secrets needed (supabase secrets set ...):
//   RESEND_API_KEY   - from resend.com dashboard
//   FROM_EMAIL       - a sender address on a domain verified in Resend
//   APP_URL          - the deployed app URL (GitHub Pages), used in email links
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically by Supabase

import { createClient } from 'jsr:@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'rides@example.com'
const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:5173'

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

// Placeholder for a real calendar free/busy check (see src/lib/calendar.ts for
// the matching client-side note). Always "available" until Google Calendar
// OAuth is wired up.
async function isAvailable(_driverId: string, _date: string, _time: string): Promise<boolean> {
  return true
}

Deno.serve(async (req) => {
  try {
    const { ride_request_id } = await req.json()
    if (!ride_request_id) {
      return new Response(JSON.stringify({ error: 'ride_request_id is required' }), { status: 400 })
    }

    const { data: rideRequest, error: rrError } = await supabaseAdmin
      .from('ride_requests')
      .select('*, requester:profiles!ride_requests_requester_id_fkey(*)')
      .eq('id', ride_request_id)
      .single()

    if (rrError || !rideRequest) {
      return new Response(JSON.stringify({ error: rrError?.message ?? 'ride request not found' }), { status: 404 })
    }

    const { data: neighbors, error: neighborsError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .neq('id', rideRequest.requester_id)

    if (neighborsError) {
      return new Response(JSON.stringify({ error: neighborsError.message }), { status: 500 })
    }

    const direction = rideRequest.direction === 'to_shuttle' ? 'to the shuttle' : 'from the shuttle';
    const requesterName = rideRequest.requester?.full_name ?? 'A neighbor'

    let asked = 0

    for (const neighbor of neighbors ?? []) {
      const available = neighbor.calendar_integrated
        ? await isAvailable(neighbor.id, rideRequest.shuttle_date, rideRequest.shuttle_time)
        : true

      const { data: offer, error: offerError } = await supabaseAdmin
        .from('ride_offers')
        .upsert(
          {
            ride_request_id: rideRequest.id,
            driver_id: neighbor.id,
            status: available ? 'pending' : 'declined'
          },
          { onConflict: 'ride_request_id,driver_id' }
        )
        .select('*')
        .single()

      if (offerError) {
        console.error('offer upsert failed', offerError)
        continue
      }

      if (offer.status !== 'pending') continue

      asked += 1
      const subject = `Ride requested: ${requesterName} needs a ride ${direction}`
      const body = neighbor.calendar_integrated
        ? `<p>${requesterName} needs a ride ${direction} on ${rideRequest.shuttle_date} at ${rideRequest.shuttle_time}.</p><p>You're free at that time. <a href="${APP_URL}">Open the app</a> to offer to drive.</p>`
        : `<p>${requesterName} needs a ride ${direction} on ${rideRequest.shuttle_date} at ${rideRequest.shuttle_time}.</p><p>Are you available and willing to give this ride? <a href="${APP_URL}">Open the app</a> to respond.</p>`

      await sendEmail(neighbor.email, subject, body)
    }

    return new Response(JSON.stringify({ ok: true, neighbors_asked: asked }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
