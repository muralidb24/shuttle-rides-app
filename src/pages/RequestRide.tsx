import { useState } from 'react'
import DirectionToggle from '../components/DirectionToggle'
import { createRideRequest } from '../lib/api'
import type { Direction } from '../types'

interface Props {
  userId: string
  onCreated: () => void
  onCancel: () => void
}

export default function RequestRide({ userId, onCreated, onCancel }: Props) {
  const [direction, setDirection] = useState<Direction>('to_shuttle')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!date || !time) return
    setLoading(true)
    setError(null)
    try {
      await createRideRequest(userId, direction, date, time)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '1.5rem 1.25rem' }}>
      <p style={{ fontWeight: 500, fontSize: 15, margin: '0 0 14px' }}>Request a ride</p>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <DirectionToggle value={direction} onChange={setDirection} />
        </div>

        <p className="label">Shuttle date</p>
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} style={{ marginBottom: 10 }} />

        <p className="label">Shuttle time</p>
        <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} style={{ marginBottom: 16 }} />

        {error && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 0 }}>{error}</p>}

        <button className="primary" type="submit" disabled={loading} style={{ width: '100%', marginBottom: 8 }}>
          {loading ? 'Sending…' : 'Find me a ride'}
        </button>
        <button type="button" className="ghost" onClick={onCancel} style={{ width: '100%' }}>
          Cancel
        </button>
      </form>
    </div>
  )
}
