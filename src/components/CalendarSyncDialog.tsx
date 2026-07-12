import { useState } from 'react'
import { connectCalendarFeed, disconnectCalendarFeed } from '../lib/api'
import type { Profile } from '../types'

interface Props {
  profile: Profile
  onClose: () => void
  onProfileChange: (profile: Profile) => void
}

export default function CalendarSyncDialog({ profile, onClose, onProfileChange }: Props) {
  const [feedUrl, setFeedUrl] = useState(profile.calendar_feed_url ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connected = Boolean(profile.calendar_integrated && profile.calendar_feed_url)

  async function handleConnect() {
    if (!feedUrl.trim()) {
      setError('Paste your calendar feed URL first.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const updated = await connectCalendarFeed(profile.id, feedUrl.trim())
      onProfileChange(updated)
      onClose()
    } catch {
      setError('Could not save that URL. Double-check it and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    setBusy(true)
    try {
      const updated = await disconnectCalendarFeed(profile.id)
      onProfileChange(updated)
      onClose()
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
      <div className="card" style={{ width: '100%', maxWidth: 400 }}>
        <p style={{ fontWeight: 500, fontSize: 15, margin: '0 0 4px' }}>Calendar sync</p>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
          {connected
            ? "Your calendar is connected. When neighbors need a ride, we'll check your calendar automatically instead of asking you directly."
            : "Paste your calendar's private iCal (ICS) feed URL below. We'll use it to check your availability automatically before asking you for rides - you won't be pinged for times you're already busy."}
        </p>

        <input
          type="url"
          value={feedUrl}
          onChange={(e) => setFeedUrl(e.target.value)}
          placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
          style={{
            width: '100%',
            border: '0.5px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            padding: 10,
            fontFamily: 'inherit',
            fontSize: 13,
            marginBottom: 8,
            background: 'var(--surface-2)',
            color: 'var(--text-primary)'
          }}
        />

        {error && (
          <p style={{ fontSize: 12, color: 'var(--danger, #d33)', margin: '0 0 8px' }}>{error}</p>
        )}

        <details style={{ marginBottom: 14 }}>
          <summary style={{ fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Where do I find this?
          </summary>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.5 }}>
            <p style={{ margin: '0 0 6px' }}>
              <strong>Google Calendar</strong>: Settings → your calendar → "Integrate calendar" → copy the
              "Secret address in iCal format."
            </p>
            <p style={{ margin: '0 0 6px' }}>
              <strong>Outlook / Outlook.com</strong>: Settings → Calendar → "Shared calendars" → publish a calendar
              and copy the ICS link.
            </p>
            <p style={{ margin: 0 }}>
              <strong>Apple Calendar (iCloud)</strong>: Right-click the calendar → Share Calendar → check "Public
              Calendar" → copy the link (change webcal:// to https://).
            </p>
          </div>
        </details>

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ flex: 1 }} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {connected && (
            <button style={{ flex: 1 }} onClick={handleDisconnect} disabled={busy}>
              {busy ? 'Removing…' : 'Disconnect'}
            </button>
          )}
          <button className="primary" style={{ flex: 1 }} onClick={handleConnect} disabled={busy}>
            {busy ? 'Saving…' : connected ? 'Update' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}
