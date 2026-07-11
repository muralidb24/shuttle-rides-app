import type { Direction } from '../types'

export function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function directionLabel(direction: Direction): string {
  return direction === 'to_shuttle' ? 'traveling out' : 'returning'
}

export function isOnHalfHour(timeStr: string): boolean {
  const [, m] = timeStr.split(':').map(Number)
  return m === 0 || m === 30
}

function subtractMinutes(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(':').map(Number)
  const total = ((h * 60 + m - minutes) % 1440 + 1440) % 1440
  const hh = Math.floor(total / 60)
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// The shuttle is a fixed ~10 minute drive away and always leaves on the hour
// or half hour. A driver picking someone up to catch it should plan to leave
// home about 15 minutes before the shuttle time (10 min drive + 5 min buffer
// at the stop). Coming back is simpler: just be at the stop when it arrives.
export function pickupGuidance(direction: Direction, shuttleTime: string): string {
  const shuttleFormatted = formatTime(shuttleTime)
  if (direction === 'to_shuttle') {
    return `Pick up ~${formatTime(subtractMinutes(shuttleTime, 15))} for the ${shuttleFormatted} shuttle`
  }
  return `Meet at the shuttle stop by ${shuttleFormatted}`
}

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}
