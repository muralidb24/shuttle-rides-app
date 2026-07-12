// Lightweight, OAuth-free calendar helpers.
//
// The product spec calls for two calendar touchpoints:
//   1. Auto-checking a homeowner's free/busy status when a ride request comes in
//      (only meaningful if we have a real two-way calendar connection, e.g. Google
//      Calendar OAuth + Free/Busy API).
//   2. Adding an accepted ride to the driver's calendar.
//
// (1) requires a server-side OAuth integration per calendar provider, which is a
// significant addition on its own (consent screen, token storage/refresh, a
// free/busy API call). It's stubbed here behind `checkCalendarAvailability` so the
// rest of the app's branching logic (see notify-neighbors) is already wired up for
// it — swap the stub body for a real Google Calendar API call when that's ready.
//
// (2) doesn't need OAuth at all: a standard .ics file or a Google Calendar "render"
// link both work with just the event details, so that's what's implemented for real
// below.

export interface CalendarEventInput {
  title: string
  description: string
  date: string // YYYY-MM-DD
  time: string // HH:MM or HH:MM:SS (Postgres `time` columns come back with seconds)
  durationMinutes?: number
}

function toDateTime(date: string, time: string): Date {
  // Build the Date from numeric parts instead of concatenating strings -
  // Postgres `time` values round-trip through supabase-js as "HH:MM:SS", and
  // naively appending ":00" to that (assuming "HH:MM") produces a malformed
  // string that `new Date(...)` silently turns into an Invalid Date, which
  // then throws downstream on `.toISOString()`.
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

function formatGoogleDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

export function googleCalendarLink(input: CalendarEventInput): string {
  const start = toDateTime(input.date, input.time)
  const end = new Date(start.getTime() + (input.durationMinutes ?? 30) * 60000)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    details: input.description,
    dates: `${formatGoogleDate(start)}/${formatGoogleDate(end)}`
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function icsDownloadUrl(input: CalendarEventInput): string {
  const start = toDateTime(input.date, input.time)
  const end = new Date(start.getTime() + (input.durationMinutes ?? 30) * 60000)
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Neighborhood Shuttle Rides//EN',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@shuttle-rides`,
    `DTSTAMP:${formatGoogleDate(new Date())}`,
    `DTSTART:${formatGoogleDate(start)}`,
    `DTEND:${formatGoogleDate(end)}`,
    `SUMMARY:${input.title}`,
    `DESCRIPTION:${input.description}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
  return `data:text/calendar;charset=utf8,${encodeURIComponent(ics)}`
}

// TODO: replace with a real Google Calendar Free/Busy API call once OAuth is wired
// up. Until then, calendar-integrated profiles are always treated as available, and
// neighbors still confirm willingness by tapping "Offer to drive".
export async function checkCalendarAvailability(
  _profileId: string,
  _date: string,
  _time: string
): Promise<boolean> {
  return true
}
