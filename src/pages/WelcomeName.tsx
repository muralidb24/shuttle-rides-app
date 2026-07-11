import { useState } from 'react'
import { UserRound } from 'lucide-react'

interface Props {
  onSubmit: (name: string) => Promise<void>
}

export default function WelcomeName({ onSubmit }: Props) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError(null)
    try {
      await onSubmit(name.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '2.5rem 1.25rem', textAlign: 'center' }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'var(--bg-accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px'
        }}
      >
        <UserRound size={28} color="var(--text-accent)" />
      </div>
      <p style={{ fontWeight: 500, fontSize: 16, margin: '0 0 4px' }}>Welcome!</p>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 20px' }}>
        What should we call you?
      </p>
      <form onSubmit={handleSubmit} style={{ textAlign: 'left' }}>
        <input
          type="text"
          required
          autoFocus
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        {error && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 0 }}>{error}</p>}
        <button className="primary" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
