import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { UserRound, BookOpen, MessageCircle, LogOut, Mail, Users, Settings, MapPin, UserX } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { deleteMyAccount, updateEmailNotificationsEnabled } from '../lib/api'
import { clearPushToken } from '../lib/push'
import AudienceSettingsDialog from './AudienceSettingsDialog'
import CommunitySettingsDialog from './CommunitySettingsDialog'
import DefaultDestinationDialog from './DefaultDestinationDialog'
import DeleteAccountDialog from './DeleteAccountDialog'
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
  const [communityDialogOpen, setCommunityDialogOpen] = useState(false)
  const [destinationDialogOpen, setDestinationDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
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

  async function handleDeleteAccount() {
    await clearPushToken()
    await deleteMyAccount()
    // The account (and its server-side session) is already gone at this
    // point - this just clears the locally-cached token so the app's own
    // auth listener sees a signed-out state and returns to the login screen,
    // the same way a normal sign-out does.
    await supabase.auth.signOut()
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
          {/* target="_blank" has no "new tab" to open into inside a native
              WKWebView/Android WebView, so it silently does nothing there -
              only use it on web, where it's a nice-to-have that keeps the
              app itself open in its own tab. */}
          <a
            href="guide.html"
            className="menu-item"
            {...(Capacitor.isNativePlatform() ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
          >
            <BookOpen size={16} /> User guide
          </a>
          <a href="mailto:rides@postalcolony.com?subject=Ride%2C%20please%20app%20feedback" className="menu-item">
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
          <button
            className="menu-item"
            onClick={() => {
              setDestinationDialogOpen(true)
              setOpen(false)
            }}
          >
            <MapPin size={16} /> Default destination
          </button>
          {profile.role === 'admin' && (
            <button
              className="menu-item"
              onClick={() => {
                setCommunityDialogOpen(true)
                setOpen(false)
              }}
            >
              <Settings size={16} /> Community settings
            </button>
          )}
          <button
            className="menu-item"
            onClick={() => {
              clearPushToken().finally(() => supabase.auth.signOut())
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
          <button
            className="menu-item"
            style={{ color: 'var(--danger, #d33)' }}
            onClick={() => {
              setDeleteDialogOpen(true)
              setOpen(false)
            }}
          >
            <UserX size={16} /> Delete my account
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

      {communityDialogOpen && <CommunitySettingsDialog profile={profile} onClose={() => setCommunityDialogOpen(false)} />}

      {destinationDialogOpen && (
        <DefaultDestinationDialog
          profile={profile}
          onClose={() => setDestinationDialogOpen(false)}
          onProfileChange={onProfileChange}
        />
      )}

      {deleteDialogOpen && (
        <DeleteAccountDialog onConfirm={handleDeleteAccount} onClose={() => setDeleteDialogOpen(false)} />
      )}
    </div>
  )
}
