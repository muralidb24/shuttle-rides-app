import { googleCalendarLink, icsDownloadUrl } from '../lib/calendar'
import { markCalendarAdded } from '../lib/api'
import { formatDate, formatTime, directionLabel } from '../lib/format'
import type { RideOffer } from '../types'

interface Props {
  offer: RideOffer
  onDone: () => void
}

export default function CalendarPrompt({ offer, onDone }: Props) {
  const request = offer.ride_request!
  const requesterName = request.requester?.full_name ?? 'your neighbor'
  const title = `Shuttle ride: give ${requesterName} a ride`
  const description = `Give ${requesterName} a ride ${directionLabel(request.direction)}.`

  const event = {
    title,
    description,
    date: request.shuttle_date,
    time: request.shuttle_time
  }

  async function handleAdd() {
    window.open(googleCalendarLink(event), '_blank', 'noopener')
    try {
      await markCalendarAdded(offer.id)
    } finally {
      onDone()
    }
  }

  return (
    <div className="card" style={{ borderColor: 'var(--border-strong)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>Ride confirmed</span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
        You're giving {requesterName} a ride {directionLabel(request.direction)}, {formatDate(request.shuttle_date)} at{' '}
        {formatTime(request.shuttle_time)}.
      </p>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px' }}>Add this to your calendar?</p>
      <button className="primary" style={{ width: '100%', marginBottom: 8 }} onClick={handleAdd}>
        Add to calendar
      </button>
      <a href={icsDownloadUrl(event)} download="ride.ics" style={{ display: 'block', textAlign: 'center', fontSize: 12, marginBottom: 8 }}>
        Download .ics instead
      </a>
      <button style={{ width: '100%', fontSize: 13 }} onClick={onDone}>
        No thanks, email me a reminder
      </button>
    </div>
  )
}
