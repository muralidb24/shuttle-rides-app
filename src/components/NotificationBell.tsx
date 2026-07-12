import { useEffect, useRef, useState } from 'react'
import { Bell, Check, CheckCheck, Mail } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../lib/api'
import { timeAgo } from '../lib/format'
import type { AppNotification } from '../types'

interface Props {
  userId: string
}

export default function NotificationBell({ userId }: Props) {
  const [items, setItems] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const unreadCount = items.filter((n) => !n.read).length

  async function refresh() {
    const data = await fetchNotifications(userId)
    setItems(data)
  }

  useEffect(() => {
    refresh()

    const channel = supabase
      .channel(`notifications-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, refresh)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Opening the bell only reveals the list - it no longer marks everything
  // read. Each alert is acknowledged individually (or all at once via the
  // "Mark all read" action) so the badge count reflects what's actually been
  // seen, not just what's been opened.
  function handleToggleOpen() {
    setOpen((v) => !v)
  }

  async function handleAcknowledge(n: AppNotification) {
    setItems((prev) => prev.map((item) => (item.id === n.id ? { ...item, read: true } : item)))
    try {
      await markNotificationRead(n.id)
    } catch {
      refresh()
    }
  }

  async function handleAcknowledgeAll() {
    setItems((prev) => prev.map((item) => ({ ...item, read: true })))
    try {
      await markAllNotificationsRead(userId)
    } catch {
      refresh()
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={handleToggleOpen}
        aria-label="Notifications"
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          padding: 0,
          background: 'var(--surface-2)',
          border: '0.5px solid var(--border-strong)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative'
        }}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              background: 'var(--danger)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px'
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{ position: 'absolute', right: 0, top: 40, width: 300, maxHeight: 360, overflowY: 'auto', padding: 6, zIndex: 10 }}
        >
          {items.length > 0 && unreadCount > 0 && (
            <button
              className="ghost"
              onClick={handleAcknowledgeAll}
              style={{
                width: '100%',
                height: 'auto',
                padding: '6px 8px',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                marginBottom: 2
              }}
            >
              <CheckCheck size={13} /> Mark all as read
            </button>
          )}
          {items.length === 0 ? (
            <p className="hint" style={{ padding: '10px 8px', margin: 0 }}>
              No notifications yet.
            </p>
          ) : (
            items.map((n) => (
              <div
                key={n.id}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius)',
                  marginBottom: 2,
                  background: n.read ? 'transparent' : 'var(--bg-accent)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                  <p style={{ fontSize: 13, margin: 0 }}>{n.title}</p>
                  {!n.read && (
                    <button
                      className="ghost"
                      onClick={() => handleAcknowledge(n)}
                      aria-label="Acknowledge notification"
                      title="Mark as read"
                      style={{ padding: 2, height: 'auto', minWidth: 'auto', flexShrink: 0 }}
                    >
                      <Check size={14} />
                    </button>
                  )}
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0' }}>{n.body}</p>
                {n.related_user && (
                  <a
                    href={`mailto:${n.related_user.email}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-accent)', marginTop: 4 }}
                  >
                    <Mail size={11} /> Email {n.related_user.full_name.split(' ')[0]}
                  </a>
                )}
                <p className="hint" style={{ margin: '4px 0 0' }}>
                  {timeAgo(n.created_at)}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
