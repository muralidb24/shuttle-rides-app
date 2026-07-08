import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import {
  acceptOffer,
  cancelOffer,
  cancelRequest,
  declineOffer,
  fetchCommittedRides,
  fetchPendingAsks,
  fetchRequestedRides,
  updateCalendarIntegrated
} from '../lib/api'
import { formatDate, formatTime, directionLabel } from '../lib/format'
import RideCard from '../components/RideCard'
import PendingAskCard from '../components/PendingAskCard'
import CalendarPrompt from '../components/CalendarPrompt'
import type { Profile, RideOffer, RideRequest } from '../types'

interface Props {
  profile: Profile
  onRequestRide: () => void
  onProfileChange: (profile: Profile) => void
}

export default function Dashboard({ profile, onRequestRide, onProfileChange }: Props) {
  const [committed, setCommitted] = useState<RideOffer[]>([])
  const [requested, setRequested] = useState<RideRequest[]>([])
  const [pendingAsks, setPendingAsks] = useState<RideOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [justAccepted, setJustAccepted] = useState<RideOffer | null>(null)

  const refresh = useCallback(async () => {
    const [c, r, p] = await Promise.all([
      fetchCommittedRides(profile.id),
      fetchRequestedRides(profile.id),
      fetchPendingAsks(profile.id)
    ])
    setCommitted(c)
    setRequested(r)
    setPendingAsks(p)
    setLoading(false)
  }, [profile.id])

  useEffect(() => {
    refresh()

    const channel = supabase
      .channel(`dashboard-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_offers', filter: `driver_id=eq.${profile.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_requests', filter: `requester_id=eq.${profile.id}` }, refresh)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile.id, refresh])

  async function handleAccept(offerId: string) {
    setBusyId(offerId)
    try {
      await acceptOffer(offerId)
      const offer = pendingAsks.find((o) => o.id === offerId) ?? null
      setJustAccepted(offer)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function handleDecline(offerId: string) {
    setBusyId(offerId)
    try {
      await declineOffer(offerId)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function handleCancelCommitted(offerId: string) {
    await cancelOffer(offerId)
    await refresh()
  }

  async function handleCancelRequested(requestId: string) {
    await cancelRequest(requestId)
    await refresh()
  }

  async function toggleCalendar() {
    const next = !profile.calendar_integrated
    await updateCalendarIntegrated(profile.id, next)
    onProfileChange({ ...profile, calendar_integrated: next })
  }

  return (
    <div style={{ padding: '1.5rem 1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>Hi, {profile.full_name.split(' ')[0]}</span>
      </div>
      <button className="ghost" onClick={toggleCalendar} style={{ padding: 0, height: 'auto', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
        Calendar sync: {profile.calendar_integrated ? 'on' : 'off'} · tap to toggle
      </button>

      <button
        className="primary"
        onClick={onRequestRide}
        style={{ width: '100%', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
      >
        Request a ride
      </button>

      {justAccepted && (
        <div style={{ marginBottom: 16 }}>
          <CalendarPrompt offer={justAccepted} onDone={() => setJustAccepted(null)} />
        </div>
      )}

      {!loading && pendingAsks.length > 0 && (
        <>
          <p className="hint" style={{ margin: '0 0 6px' }}>Ride requests needing your response</p>
          {pendingAsks.map((offer) => (
            <PendingAskCard
              key={offer.id}
              offer={offer}
              calendarIntegrated={profile.calendar_integrated}
              onAccept={handleAccept}
              onDecline={handleDecline}
              busy={busyId === offer.id}
            />
          ))}
        </>
      )}

      <p className="hint" style={{ margin: '12px 0 6px' }}>Your committed rides</p>
      {committed.length === 0 && !loading && <p className="hint" style={{ margin: '0 0 12px' }}>No committed rides yet.</p>}
      {committed.map((offer) => {
        const request = offer.ride_request!
        return (
          <RideCard
            key={offer.id}
            title={`Driving ${request.requester?.full_name ?? 'a neighbor'}`}
            subtitle={`${formatDate(request.shuttle_date)}, ${formatTime(request.shuttle_time)} · ${directionLabel(request.direction)}`}
            onCancel={() => handleCancelCommitted(offer.id)}
          />
        )
      })}

      <p className="hint" style={{ margin: '12px 0 6px' }}>Your requested rides</p>
      {requested.length === 0 && !loading && <p className="hint" style={{ margin: 0 }}>No requested rides yet.</p>}
      {requested.map((request) => {
        const statusLabel =
          request.status === 'matched' ? 'a neighbor is driving you' : 'waiting for a driver'
        return (
          <RideCard
            key={request.id}
            title={directionLabel(request.direction) === 'to shuttle' ? 'Drop-off to shuttle' : 'Pickup from shuttle'}
            subtitle={`${formatDate(request.shuttle_date)}, ${formatTime(request.shuttle_time)} · ${statusLabel}`}
            onCancel={() => handleCancelRequested(request.id)}
          />
        )
      })}
    </div>
  )
}
