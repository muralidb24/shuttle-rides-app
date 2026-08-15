import { useEffect, useState } from 'react'
import DirectionToggle from '../components/DirectionToggle'
import { createRideRequest, fetchDestinations } from '../lib/api'
import type { Destination, Direction } from '../types'

interface Props {
  userId: string
  defaultDestinationId: string | null
  onCreated: () => void
  onCancel: () => void
}

export default function RequestRide({ userId, defaultDestinationId, onCreated, onCancel }: Props) {
  const [direction, setDirection] = useState<Direction>('to_shuttle')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [destinations, setDestinations] = useState<Destination[]>([])
  const [destinationId, setDestinationId] = useState('')
  const [destinationsLoading, setDestinationsLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchDestinations()
      .then((list) => {
        if (cancelled) return
        setDestinations(list)
        // Pre-select the user's default if it's still a valid destination;
        // otherwise fall back to the first one in the list so the field is
        // never left blank when at least one destination exists.
        const fallback = list.find((d) => d.id === defaultDestinationId)?.id ?? list[0]?.id ?? ''
        setDestinationId(fallback)
      })
      .finally(() => {
        if (!cancelled) setDestinationsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [defaultDestinationId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!date || !time || !destinationId) return
    setLoading(true)
    setError(null)
    try {
      await createRideRequest(userId, direction, date, time, destinationId)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '1.5rem 1.25rem' }}>
      <p style={{ fontWeight: 500, fontSize: 16, margin: '0 0 14px' }}>Request a ride</p>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <DirectionToggle value={direction} onChange={setDirection} />
        </div>
        <p className="hint" style={{ margin: '0 0 16px' }}>
          {direction === 'to_shuttle'
            ? "We'll let your ride giver know to pick you up from home."
            : "We'll let your ride giver know to pick you up from your destination."}
        </p>

        <p className="label">Destination</p>
        {destinationsLoading ? (
          <p className="hint" style={{ margin: '0 0 16px' }}>
            Loading destinations…
          </p>
        ) : destinations.length === 0 ? (
          <p style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 16px' }}>
            Your community hasn't set up any destinations yet. Ask an admin to add one under Community settings before
            requesting a ride.
          </p>
        ) : (
          <select
            required
            value={destinationId}
            onChange={(e) => setDestinationId(e.target.value)}
            style={{ marginBottom: 16 }}
          >
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}

        <p className="label">{direction === 'to_shuttle' ? 'Travel date' : 'Return date'}</p>
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} style={{ marginBottom: 10 }} />

        <p className="label">Pickup time</p>
        <input
          type="time"
          required
          value={time}
          onChange={(e) => setTime(e.target.value)}
          style={{ marginBottom: 16 }}
        />

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 0 }}>{error}</p>}

        <button
          className="primary"
          type="submit"
          disabled={loading || destinations.length === 0}
          style={{ width: '100%', marginBottom: 8 }}
        >
          {loading ? 'Sending…' : 'Find me a ride'}
        </button>
        <button type="button" className="ghost" onClick={onCancel} style={{ width: '100%' }}>
          Cancel
        </button>
      </form>
    </div>
  )
}
