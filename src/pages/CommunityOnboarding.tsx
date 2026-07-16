import { useState } from 'react'
import { UserRound, Users } from 'lucide-react'
import { createCommunityAndJoin, joinCommunity, lookupCommunityByCode } from '../lib/api'
import type { Profile } from '../types'

interface Props {
  onDone: (profile: Profile) => void
}

type Mode = 'choose' | 'join-code' | 'join-confirm' | 'create' | 'name'
type PendingAction = 'join' | 'create'

function IconBadge({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  )
}

export default function CommunityOnboarding({ onDone }: Props) {
  const [mode, setMode] = useState<Mode>('choose')
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  const [joinCode, setJoinCode] = useState('')
  const [resolvedCommunity, setResolvedCommunity] = useState<{ id: string; name: string } | null>(null)

  const [communityName, setCommunityName] = useState('')
  const [newJoinCode, setNewJoinCode] = useState('')

  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    if (!joinCode.trim()) return
    setLoading(true)
    setError(null)
    try {
      const found = await lookupCommunityByCode(joinCode)
      if (!found) {
        setError("That code doesn't match any community. Double-check it with whoever invited you.")
        return
      }
      setResolvedCommunity(found)
      setMode('join-confirm')
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  function confirmJoin() {
    setPendingAction('join')
    setError(null)
    setMode('name')
  }

  function handleCreateContinue(e: React.FormEvent) {
    e.preventDefault()
    if (!communityName.trim() || !newJoinCode.trim()) return
    setPendingAction('create')
    setError(null)
    setMode('name')
  }

  async function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim()) return
    setLoading(true)
    setError(null)
    try {
      const profile =
        pendingAction === 'join'
          ? await joinCommunity(joinCode, fullName)
          : await createCommunityAndJoin(communityName, newJoinCode, fullName)
      onDone(profile)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message.toLowerCase().includes('duplicate') || message.includes('23505')) {
        setError('That community code is already taken - go back and pick another.')
      } else {
        setError('Something went wrong. Try again.')
      }
      setLoading(false)
    }
  }

  if (mode === 'choose') {
    return (
      <div style={{ padding: '2.5rem 1.25rem', textAlign: 'center' }}>
        <IconBadge>
          <Users size={28} color="var(--text-accent)" />
        </IconBadge>
        <p style={{ fontWeight: 500, fontSize: 16, margin: '0 0 4px' }}>Welcome!</p>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 20px' }}>
          Are you joining an existing community, or starting a new one?
        </p>
        <button className="primary" style={{ width: '100%', marginBottom: 8 }} onClick={() => setMode('join-code')}>
          I have a community code
        </button>
        <button style={{ width: '100%' }} onClick={() => setMode('create')}>
          Create a new community
        </button>
      </div>
    )
  }

  if (mode === 'join-code') {
    return (
      <div style={{ padding: '2.5rem 1.25rem', textAlign: 'center' }}>
        <IconBadge>
          <Users size={28} color="var(--text-accent)" />
        </IconBadge>
        <p style={{ fontWeight: 500, fontSize: 16, margin: '0 0 4px' }}>Join your community</p>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 20px' }}>
          Enter the community code someone shared with you.
        </p>
        <form onSubmit={handleLookup} style={{ textAlign: 'left' }}>
          <input
            type="text"
            required
            autoFocus
            placeholder="Community code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          {error && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 0 }}>{error}</p>}
          <button className="primary" type="submit" disabled={loading} style={{ width: '100%', marginBottom: 8 }}>
            {loading ? 'Checking…' : 'Continue'}
          </button>
          <button type="button" style={{ width: '100%' }} onClick={() => setMode('choose')}>
            Back
          </button>
        </form>
      </div>
    )
  }

  if (mode === 'join-confirm' && resolvedCommunity) {
    return (
      <div style={{ padding: '2.5rem 1.25rem', textAlign: 'center' }}>
        <IconBadge>
          <Users size={28} color="var(--text-accent)" />
        </IconBadge>
        <p style={{ fontWeight: 500, fontSize: 16, margin: '0 0 4px' }}>You're joining:</p>
        <p style={{ fontSize: 15, margin: '0 0 20px' }}>{resolvedCommunity.name}</p>
        <button className="primary" style={{ width: '100%', marginBottom: 8 }} onClick={confirmJoin}>
          That's right, continue
        </button>
        <button style={{ width: '100%' }} onClick={() => setMode('join-code')}>
          Back
        </button>
      </div>
    )
  }

  if (mode === 'create') {
    return (
      <div style={{ padding: '2.5rem 1.25rem', textAlign: 'center' }}>
        <IconBadge>
          <Users size={28} color="var(--text-accent)" />
        </IconBadge>
        <p style={{ fontWeight: 500, fontSize: 16, margin: '0 0 4px' }}>Create a community</p>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 20px' }}>
          You'll be its first admin. Share the code with your neighbors so they can join.
        </p>
        <form onSubmit={handleCreateContinue} style={{ textAlign: 'left' }}>
          <input
            type="text"
            required
            autoFocus
            placeholder="Community name"
            value={communityName}
            onChange={(e) => setCommunityName(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <input
            type="text"
            required
            placeholder="Community code (share this with neighbors)"
            value={newJoinCode}
            onChange={(e) => setNewJoinCode(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          {error && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 0 }}>{error}</p>}
          <button className="primary" type="submit" style={{ width: '100%', marginBottom: 8 }}>
            Continue
          </button>
          <button type="button" style={{ width: '100%' }} onClick={() => setMode('choose')}>
            Back
          </button>
        </form>
      </div>
    )
  }

  // mode === 'name'
  return (
    <div style={{ padding: '2.5rem 1.25rem', textAlign: 'center' }}>
      <IconBadge>
        <UserRound size={28} color="var(--text-accent)" />
      </IconBadge>
      <p style={{ fontWeight: 500, fontSize: 16, margin: '0 0 4px' }}>Almost there</p>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 20px' }}>
        What should we call you?
      </p>
      <form onSubmit={handleNameSubmit} style={{ textAlign: 'left' }}>
        <input
          type="text"
          required
          autoFocus
          placeholder="Your name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
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
