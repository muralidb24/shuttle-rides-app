import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setSent(true)
  }

  return (
    <div style={{ padding: '2rem 1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>Neighborhood shuttle rides</span>
      </div>

      {sent ? (
        <div className="card">
          <p style={{ margin: 0, fontSize: 13 }}>
            Check <strong>{email}</strong> for a sign-in link.
          </p>
          <p className="hint" style={{ marginTop: 8 }}>
            Didn't get it? Check spam, or{' '}
            <button className="ghost" style={{ height: 'auto', padding: 0, textDecoration: 'underline' }} onClick={() => setSent(false)}>
              try a different email
            </button>
            .
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Enter your email and we'll send a link to sign in.
          </p>
          <input
            type="email"
            required
            placeholder="name@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          {error && (
            <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 0 }}>{error}</p>
          )}
          <button className="primary" type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Sending…' : 'Send magic link'}
          </button>
          <p className="hint" style={{ marginTop: 12 }}>No password needed.</p>
        </form>
      )}
    </div>
  )
}
