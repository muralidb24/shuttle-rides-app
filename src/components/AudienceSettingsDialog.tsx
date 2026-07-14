import { useEffect, useState } from 'react'
import { fetchAllProfiles, fetchAudienceMemberIds, updateRequestAudienceSettings } from '../lib/api'
import type { Profile, RequestAudienceMode } from '../types'

interface Props {
  profile: Profile
  onClose: () => void
  onProfileChange: (profile: Profile) => void
}

const MODE_OPTIONS: Array<{ value: RequestAudienceMode; label: string; hint: string }> = [
  { value: 'everyone', label: 'Everyone', hint: 'Every neighbor can see and offer on your ride requests.' },
  { value: 'all_except', label: 'Everyone except selected neighbors', hint: 'Ask everyone but the neighbors you pick below.' },
  { value: 'only', label: 'Only selected neighbors', hint: 'Only the neighbors you pick below will ever see your requests.' }
]

export default function AudienceSettingsDialog({ profile, onClose, onProfileChange }: Props) {
  const [mode, setMode] = useState<RequestAudienceMode>(profile.request_audience_mode)
  const [allProfiles, setAllProfiles] = useState<Profile[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [profiles, memberIds] = await Promise.all([fetchAllProfiles(profile.id), fetchAudienceMemberIds(profile.id)])
        if (cancelled) return
        setAllProfiles(profiles)
        setSelectedIds(new Set(memberIds))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [profile.id])

  function toggleMember(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function handleSave() {
    if (mode !== 'everyone' && selectedIds.size === 0) {
      setError('Select at least one neighbor, or switch to "Everyone".')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const updated = await updateRequestAudienceSettings(profile.id, mode, Array.from(selectedIds))
      onProfileChange(updated)
      onClose()
    } catch {
      setError('Could not save your settings. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const showChecklist = mode !== 'everyone'

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
        <p style={{ fontWeight: 500, fontSize: 15, margin: '0 0 4px' }}>Who can see your ride requests</p>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
          This applies to every ride request you create going forward, until you change it again.
        </p>

        {MODE_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              marginBottom: 10,
              cursor: 'pointer',
              fontSize: 13
            }}
          >
            <input
              type="radio"
              name="audience-mode"
              checked={mode === opt.value}
              onChange={() => setMode(opt.value)}
              style={{ marginTop: 2 }}
            />
            <span>
              <span style={{ display: 'block', fontWeight: 500 }}>{opt.label}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {opt.hint}
              </span>
            </span>
          </label>
        ))}

        {showChecklist && (
          <div
            style={{
              border: '0.5px solid var(--border-strong)',
              borderRadius: 'var(--radius)',
              padding: 10,
              margin: '8px 0 14px',
              maxHeight: 220,
              overflowY: 'auto'
            }}
          >
            {loading ? (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Loading neighbors…
              </p>
            ) : allProfiles.length === 0 ? (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                No other neighbors yet.
              </p>
            ) : (
              allProfiles.map((p) => (
                <label
                  key={p.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0', cursor: 'pointer' }}
                >
                  <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleMember(p.id)} />
                  {p.full_name}
                </label>
              ))
            )}
          </div>
        )}

        {error && <p style={{ fontSize: 12, color: 'var(--danger, #d33)', margin: '0 0 8px' }}>{error}</p>}

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
