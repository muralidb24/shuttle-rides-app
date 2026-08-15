import { useEffect, useState } from 'react'
import { fetchDestinations, updateDefaultDestination } from '../lib/api'
import type { Destination, Profile } from '../types'

interface Props {
  profile: Profile
  onClose: () => void
  onProfileChange: (profile: Profile) => void
}

export default function DefaultDestinationDialog({ profile, onClose, onProfileChange }: Props) {
  const [destinations, setDestinations] = useState<Destination[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(profile.default_destination_id)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchDestinations()
      .then((list) => {
        if (!cancelled) setDestinations(list)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave() {
    setError(null)
    setBusy(true)
    try {
      const updated = await updateDefaultDestination(profile.id, selectedId)
      onProfileChange(updated)
      onClose()
    } catch {
      setError('Could not save your setting. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 50
      }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 420, maxHeight: '85vh', overflowY: 'auto' }}>
        <p style={{ fontWeight: 500, fontSize: 16, margin: '0 0 4px' }}>Default destination</p>
        <p className="muted" style={{ fontSize: 14, margin: '0 0 12px' }}>
          This is pre-selected whenever you request a ride - you can still pick a different destination for any
          individual request.
        </p>

        {loading ? (
          <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
            Loading destinations…
          </p>
        ) : destinations.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
            Your community hasn't set up any destinations yet - ask an admin to add some under Community settings.
          </p>
        ) : (
          <>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, cursor: 'pointer', fontSize: 14 }}>
              <input type="radio" name="default-destination" checked={selectedId === null} onChange={() => setSelectedId(null)} />
              None - ask me every time
            </label>
            {destinations.map((d) => (
              <label
                key={d.id}
                style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, cursor: 'pointer', fontSize: 14 }}
              >
                <input
                  type="radio"
                  name="default-destination"
                  checked={selectedId === d.id}
                  onChange={() => setSelectedId(d.id)}
                />
                {d.name}
              </label>
            ))}
          </>
        )}

        {error && <p style={{ fontSize: 13, color: 'var(--danger, #d33)', margin: '0 0 8px' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button style={{ flex: 1 }} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" style={{ flex: 1 }} onClick={handleSave} disabled={busy || loading}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
