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

// The app doesn't collect a per-user or per-neighborhood timezone anywhere -
// every shuttle date/time is entered and displayed as plain local wall-clock
// time, on the assumption that everyone in the community is in the same
// timezone. Calendar feed events come back in UTC (or a floating local
// time), so this is the single fixed zone used to convert between the two.
const ICS_TIMEZONE = 'America/New_York'

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

// ---------------------------------------------------------------------------
// Calendar availability checking (private iCal/ICS feed URL).
//
// This is a deliberately pragmatic ICS reader, not a full RFC 5545
// implementation:
//   - Handles non-recurring VEVENTs, plus simple FREQ=DAILY / FREQ=WEEKLY
//     RRULEs (matched by weekday only - no COUNT/UNTIL/EXDATE/multi-BYDAY).
//   - All-day (VALUE=DATE) events block the whole local day.
//   - Timestamps ending in "Z" are read as literal UTC instants; anything
//     else (floating time, or a TZID this doesn't try to resolve) is read as
//     wall-clock time in ICS_TIMEZONE.
//   - Any fetch or parse failure "fails open" (treated as available) so a
//     broken or unreachable calendar link never silently hides someone from
//     being asked - the worst case is they get asked when they're actually
//     busy, which they can just decline.
// ---------------------------------------------------------------------------

interface IcsEvent {
  start: Date
  end: Date
}

// Converts a wall-clock date/time in `timeZone` to the UTC instant it
// represents, correctly accounting for DST (the target zone's offset varies
// by date, so this can't be a fixed offset - it works by asking Intl what a
// guessed UTC instant *reads as* in that zone, then correcting the guess by
// the difference).
function zonedTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, s))
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const parts = fmt.formatToParts(guess)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  const hour = get('hour') === 24 ? 0 : get('hour')
  const asIfLocal = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'))
  const diff = asIfLocal - guess.getTime()
  return new Date(guess.getTime() - diff)
}

function weekdayInZone(date: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
  const wd = fmt.format(date)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd)
}

function dateOnlyInZone(date: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  return fmt.format(date)
}

function parseIcsDate(value: string, params: string, timeZone: string): Date {
  const isAllDay = params.includes('VALUE=DATE') || /^\d{8}$/.test(value)
  if (isAllDay) {
    const y = Number(value.slice(0, 4))
    const mo = Number(value.slice(4, 6))
    const d = Number(value.slice(6, 8))
    return zonedTimeToUtc(y, mo, d, 0, 0, 0, timeZone)
  }
  const utc = value.endsWith('Z')
  const y = Number(value.slice(0, 4))
  const mo = Number(value.slice(4, 6))
  const d = Number(value.slice(6, 8))
  const h = Number(value.slice(9, 11))
  const mi = Number(value.slice(11, 13))
  const s = Number(value.slice(13, 15)) || 0
  return utc ? new Date(Date.UTC(y, mo - 1, d, h, mi, s)) : zonedTimeToUtc(y, mo, d, h, mi, s, timeZone)
}

// ICS lines can be "folded" (continued onto the next line with a leading
// space/tab) per RFC 5545 - un-fold before parsing key:value pairs.
function unfoldIcs(text: string): string[] {
  const rawLines = text.split(/\r\n|\n|\r/)
  const lines: string[] = []
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  }
  return lines
}

function eventsOnDate(icsText: string, targetDateStr: string, timeZone: string): IcsEvent[] {
  const lines = unfoldIcs(icsText)
  const results: IcsEvent[] = []
  let inEvent = false
  let dtstart: string | null = null
  let dtstartParams = ''
  let dtend: string | null = null
  let dtendParams = ''
  let rrule: string | null = null

  const targetY = Number(targetDateStr.slice(0, 4))
  const targetM = Number(targetDateStr.slice(5, 7))
  const targetD = Number(targetDateStr.slice(8, 10))
  const targetNoon = zonedTimeToUtc(targetY, targetM, targetD, 12, 0, 0, timeZone)
  const targetWeekday = weekdayInZone(targetNoon, timeZone)

  function flush() {
    if (!dtstart) return
    try {
      const start = parseIcsDate(dtstart!, dtstartParams, timeZone)
      const end = dtend ? parseIcsDate(dtend, dtendParams, timeZone) : new Date(start.getTime() + 60 * 60 * 1000)
      const durationMs = end.getTime() - start.getTime()
      const startDateStr = dateOnlyInZone(start, timeZone)

      if (!rrule) {
        if (startDateStr === targetDateStr) results.push({ start, end })
        return
      }

      // Simple recurrence only: DAILY or WEEKLY, matched by weekday, with no
      // COUNT/UNTIL/EXDATE bounds. Errs toward treating a maybe-recurring
      // event as still happening rather than expanding the full rule.
      if (startDateStr > targetDateStr) return
      const freq = /FREQ=([A-Z]+)/.exec(rrule)?.[1]
      if (freq === 'DAILY') {
        const occStart = zonedTimeToUtc(
          targetY,
          targetM,
          targetD,
          start.getUTCHours(),
          start.getUTCMinutes(),
          start.getUTCSeconds(),
          timeZone
        )
        results.push({ start: occStart, end: new Date(occStart.getTime() + durationMs) })
      } else if (freq === 'WEEKLY') {
        if (weekdayInZone(start, timeZone) === targetWeekday) {
          const occStart = zonedTimeToUtc(
            targetY,
            targetM,
            targetD,
            start.getUTCHours(),
            start.getUTCMinutes(),
            start.getUTCSeconds(),
            timeZone
          )
          results.push({ start: occStart, end: new Date(occStart.getTime() + durationMs) })
        }
      }
    } catch (err) {
      // Skip events we can't confidently parse rather than risk a false match.
      console.error('failed to parse ICS event', err)
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === 'BEGIN:VEVENT') {
      inEvent = true
      dtstart = null
      dtend = null
      rrule = null
      dtstartParams = ''
      dtendParams = ''
      continue
    }
    if (line === 'END:VEVENT') {
      if (inEvent) flush()
      inEvent = false
      continue
    }
    if (!inEvent) continue

    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx)
    const value = line.slice(colonIdx + 1)
    const [name, ...paramParts] = key.split(';')
    const params = paramParts.join(';')

    if (name === 'DTSTART') {
      dtstart = value
      dtstartParams = params
    } else if (name === 'DTEND') {
      dtend = value
      dtendParams = params
    } else if (name === 'RRULE') {
      rrule = value
    }
  }

  return results
}

// The busy window around a ride: pickup + drive + drop-off (or the reverse
// for a return trip), consistent with the ~10 minute shuttle drive and the
// "no more than half an hour round trip" the spec describes. Skewed
// slightly differently per direction since the driver's own commitment
// falls on a different side of the shuttle time.
function busyWindow(direction: string, shuttleDate: string, shuttleTime: string, timeZone: string): { start: Date; end: Date } {
  const [sh, sm] = shuttleTime.split(':').map(Number)
  const shuttleMinutes = sh * 60 + sm
  const windowStartMin = direction === 'to_shuttle' ? shuttleMinutes - 20 : shuttleMinutes - 15
  const windowEndMin = direction === 'to_shuttle' ? shuttleMinutes + 10 : shuttleMinutes + 15
  const toHM = (mins: number) => {
    const wrapped = ((mins % 1440) + 1440) % 1440
    return { h: Math.floor(wrapped / 60), m: wrapped % 60 }
  }
  const [y, mo, d] = shuttleDate.split('-').map(Number)
  const startHM = toHM(windowStartMin)
  const endHM = toHM(windowEndMin)
  return {
    start: zonedTimeToUtc(y, mo, d, startHM.h, startHM.m, 0, timeZone),
    end: zonedTimeToUtc(y, mo, d, endHM.h, endHM.m, 0, timeZone)
  }
}

async function checkCalendarAvailability(
  feedUrl: string | null | undefined,
  direction: string,
  shuttleDate: string,
  shuttleTime: string
): Promise<{ available: boolean; checked: boolean; error?: string }> {
  if (!feedUrl) return { available: true, checked: false }
  try {
    const res = await fetch(feedUrl)
    if (!res.ok) {
      return { available: true, checked: false, error: `feed fetch failed: ${res.status}` }
    }
    const text = await res.text()
    const window = busyWindow(direction, shuttleDate, shuttleTime, ICS_TIMEZONE)
    const events = eventsOnDate(text, shuttleDate, ICS_TIMEZONE)
    const conflict = events.some((ev) => ev.start < window.end && ev.end > window.start)
    return { available: !conflict, checked: true }
  } catch (err) {
    console.error('calendar feed check failed', err)
    return { available: true, checked: false, error: String(err) }
  }
}

// A neighbor who has already committed to give another ride can't reasonably
// be asked to give this one too if the two are too close together - treat
// them as unavailable for two hours around any ride they've already
// accepted. This is independent of (and checked in addition to) external
// calendar sync, since it's the app's own data and applies to every
// neighbor, synced or not.
const COMMITTED_RIDE_BUFFER_MS = 2 * 60 * 60 * 1000

function toUtcMillis(dateStr: string, timeStr: string, timeZone: string): number {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi] = timeStr.split(':').map(Number)
  return zonedTimeToUtc(y, mo, d, h, mi, 0, timeZone).getTime()
}

async function hasCommittedRideConflict(driverId: string, shuttleDate: string, shuttleTime: string): Promise<boolean> {
  const target = toUtcMillis(shuttleDate, shuttleTime, ICS_TIMEZONE)
  const { data, error } = await supabaseAdmin
    .from('ride_offers')
    .select('ride_request:ride_requests(shuttle_date, shuttle_time)')
    .eq('driver_id', driverId)
    .eq('status', 'accepted')

  if (error || !data) return false

  for (const row of data as unknown as Array<{ ride_request: { shuttle_date: string; shuttle_time: string } | null }>) {
    const committed = row.ride_request
    if (!committed) continue
    const committedTime = toUtcMillis(committed.shuttle_date, committed.shuttle_time, ICS_TIMEZONE)
    if (Math.abs(committedTime - target) < COMMITTED_RIDE_BUFFER_MS) return true
  }
  return false
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

    // Every profile belongs to exactly one community, and requests must
    // never fan out across communities - unlike the availability checks
    // below (which fail OPEN on error, since worst case is asking someone
    // who's busy), this fails CLOSED: if the requester somehow has no
    // community_id, that's a data integrity problem, not something to
    // paper over by silently asking the entire user base.
    if (!rideRequest.requester?.community_id) {
      return new Response(JSON.stringify({ error: 'requester has no community_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: neighbors, error: neighborsError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('community_id', rideRequest.requester.community_id)
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

    // Audience control: a requester can restrict which neighbors their own
    // requests go to (everyone / everyone except some / only some), set
    // once as a persistent profile preference rather than chosen per
    // request. This is a hard gate applied before calendar/committed-ride
    // availability - an excluded neighbor never gets an offer row at all,
    // same as if they didn't exist in the community. On a lookup failure,
    // fail open to "everyone" (same philosophy as the calendar checks
    // below) rather than silently asking no one.
    const audienceMode = rideRequest.requester?.request_audience_mode ?? 'everyone'
    let neighborPool = neighbors ?? []

    if (audienceMode !== 'everyone') {
      const { data: audienceRows, error: audienceError } = await supabaseAdmin
        .from('request_audience_members')
        .select('member_id')
        .eq('requester_id', rideRequest.requester_id)

      if (audienceError) {
        console.error('failed to load audience selections, defaulting to everyone', audienceError)
      } else {
        const memberIds = new Set((audienceRows ?? []).map((r) => r.member_id as string))
        neighborPool =
          audienceMode === 'only'
            ? neighborPool.filter((n) => memberIds.has(n.id))
            : neighborPool.filter((n) => !memberIds.has(n.id))
      }
    }

    let asked = 0
    const emailResults: EmailResult[] = []
    const availabilityChecks: Array<{ to: string; checked: boolean; available: boolean; error?: string }> = []

    for (const neighbor of neighborPool) {
      let available = true
      let checked = false
      let checkError: string | undefined

      if (neighbor.calendar_integrated && neighbor.calendar_feed_url) {
        const result = await checkCalendarAvailability(
          neighbor.calendar_feed_url,
          rideRequest.direction,
          rideRequest.shuttle_date,
          rideRequest.shuttle_time
        )
        available = result.available
        checked = result.checked
        checkError = result.error
      }

      // Checked regardless of calendar sync - this uses the app's own data,
      // not an external feed.
      if (available) {
        const conflict = await hasCommittedRideConflict(neighbor.id, rideRequest.shuttle_date, rideRequest.shuttle_time)
        if (conflict) {
          available = false
          checked = true
          checkError = 'already committed to another ride within 2 hours'
        }
      }

      if (neighbor.calendar_integrated || checked) {
        availabilityChecks.push({ to: neighbor.email, checked, available, error: checkError })
      }

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
      JSON.stringify({
        ok: true,
        neighbors_asked: asked,
        from_email: FROM_EMAIL,
        email_results: emailResults,
        availability_checks: availabilityChecks
      }),
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
