import { useEffect, useState } from 'react'
import {
  createDestination,
  deleteDestination,
  fetchCommunity,
  fetchCommunityMembers,
  fetchDestinations,
  setMemberRole,
  updateCommunity,
  updateDestination
} from '../lib/api'
import type { Community, Destination, Profile } from '../types'

interface Props {
  profile: Profile
  onClose: () => void
}

export default function CommunitySettingsDialog({ profile, onClose }: Props) {
  const [community, setCommunity] = useState<Community | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [destinations, setDestinations] = useState<Destination[]>([])
  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [newDestinationName, setNewDestinationName] = useState('')
  const [editingDestinationId, setEditingDestinationId] = useState<string | null>(null)
  const [editingDestinationName, setEditingDestinationName] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [destinationError, setDestinationError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [c, m, d] = await Promise.all([
          fetchCommunity(profile.community_id),
          fetchCommunityMembers(),
          fetchDestinations()
        ])
        if (cancelled) return
        setCommunity(c)
        setName(c.name)
        setJoinCode(c.join_code)
        setMembers(m)
        setDestinations(d)
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

  async function handleAddDestination() {
    if (!newDestinationName.trim()) return
    setBusy(true)
    setDestinationError(null)
    try {
      const created = await createDestination(profile.community_id, newDestinationName)
      setDestinations((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setNewDestinationName('')
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      setDestinationError(
        message.toLowerCase().includes('duplicate') ? 'That destination already exists.' : 'Could not add destination.'
      )
    } finally {
      setBusy(false)
    }
  }

  function startRenameDestination(d: Destination) {
    setEditingDestinationId(d.id)
    setEditingDestinationName(d.name)
    setDestinationError(null)
  }

  async function handleSaveRenameDestination() {
    if (!editingDestinationId || !editingDestinationName.trim()) return
    setBusy(true)
    setDestinationError(null)
    try {
      const updated = await updateDestination(editingDestinationId, editingDestinationName)
      setDestinations((prev) =>
        prev.map((d) => (d.id === updated.id ? updated : d)).sort((a, b) => a.name.localeCompare(b.name))
      )
      setEditingDestinationId(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      setDestinationError(
        message.toLowerCase().includes('duplicate') ? 'That destination already exists.' : 'Could not rename destination.'
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteDestination(d: Destination) {
    setBusy(true)
    setDestinationError(null)
    try {
      await deleteDestination(d.id)
      setDestinations((prev) => prev.filter((x) => x.id !== d.id))
    } catch {
      // Most likely cause: a live ride request still references this
      // destination (deletion is restricted by the DB, not just RLS).
      setDestinationError('Could not delete - it may still be used by an active ride request.')
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

            <p style={{ fontWeight: 500, fontSize: 13, margin: '18px 0 8px' }}>Destinations</p>
            <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
              These are the places members can request a ride to or from - add every stop your community regularly uses.
            </p>
            {destinations.map((d) => (
              <div
                key={d.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px 0',
                  fontSize: 13,
                  borderBottom: '0.5px solid var(--border)',
                  gap: 8
                }}
              >
                {editingDestinationId === d.id ? (
                  <>
                    <input
                      type="text"
                      value={editingDestinationName}
                      onChange={(e) => setEditingDestinationName(e.target.value)}
                      style={{ flex: 1, fontSize: 13 }}
                    />
                    <button style={{ fontSize: 12 }} onClick={handleSaveRenameDestination} disabled={busy}>
                      Save
                    </button>
                    <button style={{ fontSize: 12 }} onClick={() => setEditingDestinationId(null)} disabled={busy}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span>{d.name}</span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button style={{ fontSize: 12 }} onClick={() => startRenameDestination(d)} disabled={busy}>
                        Rename
                      </button>
                      <button style={{ fontSize: 12 }} onClick={() => handleDeleteDestination(d)} disabled={busy}>
                        Delete
                      </button>
                    </span>
                  </>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
              <input
                type="text"
                placeholder="Add a destination"
                value={newDestinationName}
                onChange={(e) => setNewDestinationName(e.target.value)}
                style={{ flex: 1, fontSize: 13 }}
              />
              <button style={{ fontSize: 12 }} onClick={handleAddDestination} disabled={busy || !newDestinationName.trim()}>
                Add
              </button>
            </div>
            {destinationError && (
              <p style={{ fontSize: 12, color: 'var(--danger, #d33)', margin: '0 0 8px' }}>{destinationError}</p>
            )}

            <p style={{ fontWeight: 500, fontSize: 13, margin: '18px 0 8px' }}>Members</p>
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
                {/* No per-member role tag here anymore - now that everyone
                    is an admin by default, an "Admin" label next to every
                    single name would just be noise. */}
                <span>
                  {m.full_name} {m.id === profile.id && <span className="muted">(you)</span>}
                </span>
                {/* Everyone is an admin by default now, and admin access can
                    only ever be granted here, never taken away - removing
                    someone's admin access was a rarely-used capability that
                    mainly created a way to accidentally (or not) lock a
                    neighbor out of managing the community they're part of. */}
                {m.id !== profile.id && m.role !== 'admin' && (
                  <button style={{ fontSize: 12 }} onClick={() => handleRoleToggle(m)} disabled={busy}>
                    Make admin
                  </button>
                )}
              </div>
            ))}
          </>
        )}

        {!loading && (
          <button
            className="primary"
            style={{ width: '100%', marginTop: 18, marginBottom: 8 }}
            onClick={handleSaveCommunity}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        )}

        <button style={{ width: '100%' }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
