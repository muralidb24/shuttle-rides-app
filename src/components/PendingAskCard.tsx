import { Calendar, Clock, UserRound } from 'lucide-react'
import { directionLabel, formatDate, formatTime } from '../lib/format'
import type { RideOffer } from '../types'

interface Props {
  offer: RideOffer
  calendarIntegrated: boolean
  onAccept: (offerId: string) => void
  onDecline: (offerId: string) => void
  busy?: boolean
}

export default function PendingAskCard({ offer, calendarIntegrated, onAccept, onDecline, busy }: Props) {
  const request = offer.ride_request!
  const requesterName = request.requester?.full_name ?? 'A neighbor'

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <UserRound size={14} /> {requesterName}
        </span>
        <span className={`badge ${calendarIntegrated ? 'success' : 'neutral'}`}>
          {calendarIntegrated ? 'Calendar synced' : 'No calendar linked'}
        </span>
      </div>
      <div className="ride-card-meta" style={{ marginBottom: 8 }}>
        <span>
          <Calendar size={12} /> {formatDate(request.shuttle_date)}
        </span>
        <span>
          <Clock size={12} /> {formatTime(request.shuttle_time)}
        </span>
        <span>{directionLabel(request.direction)}</span>
      </div>

      {calendarIntegrated ? (
        <button className="primary" style={{ width: '100%', fontSize: 13 }} disabled={busy} onClick={() => onAccept(offer.id)}>
          Offer to drive
        </button>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px' }}>Available and willing to drive?</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ flex: 1, fontSize: 13 }} disabled={busy} onClick={() => onAccept(offer.id)}>
              I can help
            </button>
            <button style={{ flex: 1, fontSize: 13 }} disabled={busy} onClick={() => onDecline(offer.id)}>
              Not available
            </button>
          </div>
        </>
      )}
    </div>
  )
}
