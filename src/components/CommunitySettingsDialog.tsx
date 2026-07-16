import { useEffect, useState } from 'react'
import { fetchCommunity, fetchCommunityMembers, setMemberRole, updateCommunity } from '../lib/api'
import type { Community, Profile } from '../types'

interface Props {
  profile: Profile
  onClose: () => void
}

export default function CommunitySettingsDialog({ profile, onClose }: Props) {
  const [community, setCommunity] = useState<Community | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [c, m] = await Promise.all([fetchCommunity(profile.community_id), fetchCommunityMembers()])
        if (cancelled) return
        setCommunity(c)
        setName(c.name)
        setJoinCode(c.join_code)
        setMembers(m)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [profile.community_id])

  async function handleSaveCommunity() {
    if (!name.trim() || !joinCode.trim()) return
    setBusy(true)
    setError(null)
    try {
      const updated = await updateCommunity(profile.community_id, { name: name.trim(), join_code: joinCode.trim() })
      setCommunity(updated)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      setError(message.toLowerCase().includes('duplicate') ? 'That code is already taken.' : 'Could not save. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRoleToggle(member: Profile) {
    const nextRole = member.role === 'admin' ? 'member' : 'admin'
    setBusy(true)
    try {
      await setMemberRole(member.id, nextRole)
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role: nextRole } : m)))
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
      <div className="card" style={{ width: '100%', maxWidth: 440, maxHeight: '85vh', overflowY: 'auto' }}>
        <p style={{ fontWeight: 500, fontSize: 15, margin: '0 0 12px' }}>Community settings</p>

        {loading ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Loading…
          </p>
        ) : (
          <>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Community name
            </label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />

            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Join code (share with neighbors)
            </label>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              style={{ width: '100%', marginBottom: 10 }}
            />

            {error && <p style={{ fontSize: 12, color: 'var(--danger, #d33)', margin: '0 0 8px' }}>{error}</p>}

            <button className="primary" style={{ width: '100%', marginBottom: 18 }} onClick={handleSaveCommunity} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>

            <p style={{ fontWeight: 500, fontSize: 13, margin: '0 0 8px' }}>Members</p>
            {members.map((m) => (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px 0',
                  fontSize: 13,
                  borderBottom: '0.5px solid var(--border)'
                }}
              >
                <span>
                  {m.full_name} {m.id === profile.id && <span className="muted">(you)</span>}
                  <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                    {m.role === 'admin' ? 'Admin' : 'Member'}
                  </span>
                </span>
                {m.id !== profile.id && (
                  <button style={{ fontSize: 12 }} onClick={() => handleRoleToggle(m)} disabled={busy}>
                    {m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                  </button>
                )}
              </div>
            ))}
          </>
        )}

        <button style={{ width: '100%', marginTop: 14 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
