import { useState } from 'react'

interface Props {
  onConfirm: () => Promise<void>
  onClose: () => void
}

const CONFIRM_TEXT = 'DELETE'

// A one-way action - once the account is gone, so is everything with it, so
// this asks for a typed confirmation rather than just a click, the same way
// other truly destructive actions (like emptying a trash folder) usually
// do. Anything reversible in this app (cancelling a ride, removing someone's
// admin access) just uses a plain confirm button - this is the one place
// that doesn't.
export default function DeleteAccountDialog({ onConfirm, onClose }: Props) {
  const [typed, setTyped] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setLoading(true)
    setError(null)
    try {
      await onConfirm()
    } catch {
      setError('Something went wrong deleting your account. Please try again.')
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
        <p style={{ fontWeight: 500, fontSize: 16, margin: '0 0 4px' }}>Delete your account</p>
        <p className="muted" style={{ fontSize: 14, margin: '0 0 10px' }}>
          This permanently deletes your account and everything tied to it - your profile, ride history, and
          notifications. It can't be undone.
        </p>
        <p className="muted" style={{ fontSize: 14, margin: '0 0 10px' }}>
          Any ride you're currently committed to give will be cancelled and reopened to other neighbors, and any
          ride you've requested will be cancelled too - the other side will be notified either way.
        </p>
        <p style={{ fontSize: 14, margin: '0 0 6px' }}>
          Type <strong>{CONFIRM_TEXT}</strong> to confirm.
        </p>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={CONFIRM_TEXT}
          style={{ width: '100%', marginBottom: 10 }}
          autoCapitalize="characters"
          autoCorrect="off"
        />
        {error && <p style={{ fontSize: 13, color: 'var(--danger, #d33)', margin: '0 0 8px' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ flex: 1 }} onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="primary"
            style={{ flex: 1, background: 'var(--danger, #d33)', borderColor: 'var(--danger, #d33)' }}
            onClick={handleConfirm}
            disabled={loading || typed.trim().toUpperCase() !== CONFIRM_TEXT}
          >
            {loading ? 'Deleting…' : 'Delete account'}
          </button>
        </div>
      </div>
    </div>
  )
}
