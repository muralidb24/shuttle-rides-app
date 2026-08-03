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

// Destinations are community-configurable now (not a single fixed shuttle
// stop with a known drive time), so there's no basis left for computing a
// derived "leave N minutes early" buffer - the date/time a requester picks
// IS the pickup time, full stop. This just describes *where* the pickup
// happens for the chosen direction: home when heading out, the destination
// itself when heading back.
export function pickupLocationLabel(direction: Direction, destinationName?: string): string {
  if (direction === 'to_shuttle') return 'Pick up from home'
  return destinationName ? `Pick up from ${destinationName}` : 'Pick up from the destination'
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
