import { useEffect, useRef, useState } from 'react'
import { UserRound, BookOpen, MessageCircle, LogOut, Mail, Users } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { updateEmailNotificationsEnabled } from '../lib/api'
import AudienceSettingsDialog from './AudienceSettingsDialog'
import type { Profile, RequestAudienceMode } from '../types'

interface Props {
  profile: Profile
  onProfileChange: (profile: Profile) => void
}

const AUDIENCE_MODE_LABELS: Record<RequestAudienceMode, string> = {
  everyone: 'everyone',
  all_except: 'custom (excluding some)',
  only: 'custom (selected only)'
}

export default function ProfileMenu({ profile, onProfileChange }: Props) {
  const [open, setOpen] = useState(false)
  const [audienceDialogOpen, setAudienceDialogOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const initials = profile.full_name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  async function toggleEmail() {
    const next = !profile.email_notifications_enabled
    await updateEmailNotificationsEnabled(profile.id, next)
    onProfileChange({ ...profile, email_notifications_enabled: next })
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Profile menu"
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          padding: 0,
          background: 'var(--bg-accent)',
          color: 'var(--text-accent)',
          border: 'none',
          fontSize: 12,
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {initials || <UserRound size={16} />}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: 'absolute',
            right: 0,
            top: 40,
            width: 220,
            padding: 6,
            zIndex: 10
          }}
        >
          <a href="guide.html" target="_blank" rel="noopener noreferrer" className="menu-item">
            <BookOpen size={16} /> User guide
          </a>
          <a href="mailto:rides@postalcolony.com?subject=Shuttle%20rides%20app%20feedback" className="menu-item">
            <MessageCircle size={16} /> Send feedback
          </a>
          <button className="menu-item" onClick={toggleEmail}>
            <Mail size={16} /> Email notifications: {profile.email_notifications_enabled ? 'on' : 'off'}
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setAudienceDialogOpen(true)
              setOpen(false)
            }}
          >
            <Users size={16} /> Who sees my requests: {AUDIENCE_MODE_LABELS[profile.request_audience_mode]}
          </button>
          <button className="menu-item" onClick={() => supabase.auth.signOut()}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}

      {audienceDialogOpen && (
        <AudienceSettingsDialog
          profile={profile}
          onClose={() => setAudienceDialogOpen(false)}
          onProfileChange={onProfileChange}
        />
      )}
    </div>
  )
}
