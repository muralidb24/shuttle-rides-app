import { useCallback, useEffect, useState } from 'react'
import { Calendar, CarFront, Plus } from 'lucide-react'
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
import { directionLabel, formatDate, formatTime } from '../lib/format'
import RideCard from '../components/RideCard'
import PendingAskCard from '../components/PendingAskCard'
import CalendarPrompt from '../components/CalendarPrompt'
import ProfileMenu from '../components/ProfileMenu'
import type { Profile, RideOffer, RideRequest } from '../types'

interface Props {
  profile: Profile
  onRequestRide: () => void
  onProfileChange: (profile: Profile) => void
}

type Tab = 'committed' | 'requested'

export default function Dashboard({ profile, onRequestRide, onProfileChange }: Props) {
  const [committed, setCommitted] = useState<RideOffer[]>([])
  const [requested, setRequested] = useState<RideRequest[]>([])
  const [pendingAsks, setPendingAsks] = useState<RideOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [justAccepted, setJustAccepted] = useState<RideOffer | null>(null)
  const [tab, setTab] = useState<Tab>('committed')

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
        <ProfileMenu name={profile.full_name} />
      </div>
      <button
        className="ghost"
        onClick={toggleCalendar}
        style={{
          padding: 0,
          height: 'auto',
          fontSize: 12,
          color: 'var(--text-secondary)',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 4
        }}
      >
        <Calendar size={12} /> Calendar sync: {profile.calendar_integrated ? 'on' : 'off'}
      </button>

      <button
        className="primary"
        onClick={onRequestRide}
        style={{ width: '100%', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
      >
        <Plus size={16} /> Request a ride
      </button>

      {justAccepted && (
        <div style={{ marginBottom: 16 }}>
          <CalendarPrompt offer={justAccepted} onDone={() => setJustAccepted(null)} />
        </div>
      )}

      {!loading && pendingAsks.length > 0 && (
        <>
          <p className="hint" style={{ margin: '0 0 6px' }}>Needs your response</p>
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

      <div className="tabs">
        <button className={tab === 'committed' ? 'active' : ''} onClick={() => setTab('committed')}>
          Committed ({committed.length})
        </button>
        <button className={tab === 'requested' ? 'active' : ''} onClick={() => setTab('requested')}>
          Requested ({requested.length})
        </button>
      </div>

      {tab === 'committed' &&
        (committed.length === 0 ? (
          !loading && (
            <div className="empty-state">
              <CarFront size={22} style={{ marginBottom: 6 }} />
              <p style={{ margin: 0 }}>No committed rides yet.</p>
            </div>
          )
        ) : (
          committed.map((offer) => {
            const request = offer.ride_request!
            return (
              <RideCard
                key={offer.id}
                title={`Driving ${request.requester?.full_name ?? 'a neighbor'}`}
                date={formatDate(request.shuttle_date)}
                time={formatTime(request.shuttle_time)}
                meta={directionLabel(request.direction)}
                onCancel={() => handleCancelCommitted(offer.id)}
              />
            )
          })
        ))}

      {tab === 'requested' &&
        (requested.length === 0 ? (
          !loading && (
            <div className="empty-state">
              <CarFront size={22} style={{ marginBottom: 6 }} />
              <p style={{ margin: 0 }}>No requested rides yet.</p>
            </div>
          )
        ) : (
          requested.map((request) => {
            const statusLabel = request.status === 'matched' ? 'driver confirmed' : 'waiting for a driver'
            return (
              <RideCard
                key={request.id}
                title={request.direction === 'to_shuttle' ? 'Drop-off to shuttle' : 'Pickup from shuttle'}
                date={formatDate(request.shuttle_date)}
                time={formatTime(request.shuttle_time)}
                meta={statusLabel}
                onCancel={() => handleCancelRequested(request.id)}
              />
            )
          })
        ))}
    </div>
  )
}
