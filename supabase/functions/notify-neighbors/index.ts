// Edge function: fans a new ride request out to every other neighbor, writes an
// in-app notification for each, and emails them (unless they've opted out of
// email notifications). Invoked by the client right after a ride request is
// inserted — see src/lib/api.ts `createRideRequest`.
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

// Browsers send a CORS preflight (OPTIONS) before the actual POST whenever the
// call crosses origins - which it always does here, since the app is served
// from GitHub Pages and calls *.supabase.co. Without an explicit OPTIONS
// handler + CORS headers on every response, the preflight fails and the
// browser never sends the real request at all - it silently drops, so
// nothing gets created and no error surfaces to the user.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

interface EmailResult {
  to: string
  sent: boolean
  error?: string
}

// Returns a result object instead of swallowing failures - a failed Resend
// call used to only show up in console.error, which meant a silently
// undelivered email looked identical to a delivered one from the caller's
// perspective (and from the app's perspective, since the client never sees
// this function's internals). Surfacing it in the response makes it
// possible to actually diagnose "the email never arrived" reports.
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

// Placeholder for a real calendar free/busy check (see src/lib/calendar.ts for
// the matching client-side note). Always "available" until Google Calendar
// OAuth is wired up.
async function isAvailable(_driverId: string, _date: string, _time: string): Promise<boolean> {
  return true
}

function subtractMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m - minutes
  const wrapped = ((total % 1440) + 1440) % 1440
  const hh = Math.floor(wrapped / 60)
  const mm = wrapped % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// The shuttle is a fixed ~10 minute drive away and always leaves on the hour
// or half hour, so a ride giver picking someone up to catch it should leave
// home about 15 minutes before the shuttle time (10 min drive + 5 min
// buffer). Returning is simpler - just be at the stop when the shuttle
// arrives.
function pickupGuidance(direction: string, shuttleTime: string): string {
  if (direction === 'to_shuttle') {
    const pickup = subtractMinutes(shuttleTime, 15)
    return `Plan to pick them up from home around ${pickup} - about 15 minutes before the ${shuttleTime} shuttle.`
  }
  return `Plan to be at the shuttle stop by ${shuttleTime} to bring them home.`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { ride_request_id } = await req.json()
    if (!ride_request_id) {
      return new Response(JSON.stringify({ error: 'ride_request_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: rideRequest, error: rrError } = await supabaseAdmin
      .from('ride_requests')
      .select('*, requester:profiles!ride_requests_requester_id_fkey(*)')
      .eq('id', ride_request_id)
      .single()

    if (rrError || !rideRequest) {
      return new Response(JSON.stringify({ error: rrError?.message ?? 'ride request not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: neighbors, error: neighborsError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .neq('id', rideRequest.requester_id)

    if (neighborsError) {
      return new Response(JSON.stringify({ error: neighborsError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const direction = rideRequest.direction === 'to_shuttle' ? 'traveling out' : 'returning home'
    const requesterName = rideRequest.requester?.full_name ?? 'A neighbor'
    const guidance = pickupGuidance(rideRequest.direction, rideRequest.shuttle_time)

    let asked = 0
    const emailResults: EmailResult[] = []

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
      const subject = `Ride requested: ${requesterName} is ${direction}`
      const intro = `<p>${requesterName} is ${direction} and needs a ride for the ${rideRequest.shuttle_date} shuttle at ${rideRequest.shuttle_time}.</p><p>${guidance}</p>`
      const body = neighbor.calendar_integrated
        ? `${intro}<p>You're free at that time. <a href="${APP_URL}">Open the app</a> to offer to give this ride.</p>`
        : `${intro}<p>Are you available and willing to give this ride? <a href="${APP_URL}">Open the app</a> to respond.</p>`

      await supabaseAdmin.from('notifications').insert({
        user_id: neighbor.id,
        type: 'ride_requested',
        title: 'Ride requested',
        body: `${requesterName} is ${direction}, shuttle at ${rideRequest.shuttle_time} on ${rideRequest.shuttle_date}. ${guidance}`,
        ride_request_id: rideRequest.id,
        related_user_id: rideRequest.requester_id
      })

      if (neighbor.email_notifications_enabled !== false) {
        emailResults.push(await sendEmail(neighbor.email, subject, body))
      } else {
        emailResults.push({ to: neighbor.email, sent: false, error: 'opted out of email notifications' })
      }
    }

    return new Response(
      JSON.stringify({ ok: true, neighbors_asked: asked, from_email: FROM_EMAIL, email_results: emailResults }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
