import { useEffect, useRef, useState } from 'react'
import { Bell, Mail } from 'lucide-react'
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

  async function handleToggleOpen() {
    const next = !open
    setOpen(next)
    if (next && unreadCount > 0) {
      await markAllNotificationsRead(userId)
      refresh()
    }
  }

  async function handleItemClick(n: AppNotification) {
    if (!n.read) {
      await markNotificationRead(n.id)
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
          style={{ position: 'absolute', right: 0, top: 40, width: 280, maxHeight: 340, overflowY: 'auto', padding: 6, zIndex: 10 }}
        >
          {items.length === 0 ? (
            <p className="hint" style={{ padding: '10px 8px', margin: 0 }}>
              No notifications yet.
            </p>
          ) : (
            items.map((n) => (
              <div
                key={n.id}
                onClick={() => handleItemClick(n)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius)',
                  marginBottom: 2,
                  background: n.read ? 'transparent' : 'var(--bg-accent)',
                  cursor: 'default'
                }}
              >
                <p style={{ fontSize: 13, margin: 0 }}>{n.title}</p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0' }}>{n.body}</p>
                {n.related_user && (
                  <a
                    href={`mailto:${n.related_user.email}`}
                    onClick={(e) => e.stopPropagation()}
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
