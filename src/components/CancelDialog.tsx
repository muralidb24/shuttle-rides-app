import { useState } from 'react'

interface Props {
  title: string
  onConfirm: (note: string) => Promise<void>
  onClose: () => void
  // The app can't remove a calendar entry it added on the driver's behalf -
  // "Add to calendar" is a one-way Google Calendar link / ICS download, not
  // a real two-way integration - so when a driver cancels a ride they'd
  // committed to, we remind them to remove it themselves. Only relevant for
  // that direction: a requester cancelling their own request never had a
  // calendar entry to begin with.
  showCalendarReminder?: boolean
}

export default function CancelDialog({ title, onConfirm, onClose, showCalendarReminder }: Props) {
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleConfirm() {
    setLoading(true)
    try {
      await onConfirm(note.trim())
    } finally {
      setLoading(false)
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
      <div className="card" style={{ width: '100%', maxWidth: 360 }}>
        <p style={{ fontWeight: 500, fontSize: 15, margin: '0 0 4px' }}>{title}</p>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
          Let them know why, or just leave a quick note - totally optional.
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Sorry, something came up..."
          rows={3}
          style={{
            width: '100%',
            border: '0.5px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            padding: 10,
            fontFamily: 'inherit',
            fontSize: 13,
            marginBottom: 12,
            resize: 'vertical',
            background: 'var(--surface-2)',
            color: 'var(--text-primary)'
          }}
        />
        {showCalendarReminder && (
          <p className="hint" style={{ margin: '0 0 12px' }}>
            If you added this to your calendar, remember to remove it too - we can't do that part for you.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ flex: 1 }} onClick={onClose} disabled={loading}>
            Keep ride
          </button>
          <button className="primary" style={{ flex: 1 }} onClick={handleConfirm} disabled={loading}>
            {loading ? 'Cancelling…' : 'Cancel ride'}
          </button>
        </div>
      </div>
    </div>
  )
}
