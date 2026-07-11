import { supabase } from '../supabaseClient'
import type { AppNotification, Direction, Profile, RideOffer, RideRequest } from '../types'
import type { User } from '@supabase/supabase-js'

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  return (data as Profile) ?? null
}

export async function createProfile(user: User, fullName: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .insert({ id: user.id, email: user.email, full_name: fullName.trim() })
    .select('*')
    .single()

  if (error) throw error
  return data as Profile
}

export async function updateCalendarIntegrated(userId: string, integrated: boolean) {
  const { error } = await supabase.from('profiles').update({ calendar_integrated: integrated }).eq('id', userId)
  if (error) throw error
}

export async function updateEmailNotificationsEnabled(userId: string, enabled: boolean) {
  const { error } = await supabase.from('profiles').update({ email_notifications_enabled: enabled }).eq('id', userId)
  if (error) throw error
}

export async function fetchCommittedRides(userId: string): Promise<RideOffer[]> {
  const { data, error } = await supabase
    .from('ride_offers')
    .select('*, ride_request:ride_requests(*, requester:profiles!ride_requests_requester_id_fkey(*))')
    .eq('driver_id', userId)
    .eq('status', 'accepted')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as RideOffer[]
}

export async function fetchRequestedRides(userId: string): Promise<RideRequest[]> {
  const { data, error } = await supabase
    .from('ride_requests')
    .select('*, offers:ride_offers(*, driver:profiles!ride_offers_driver_id_fkey(*))')
    .eq('requester_id', userId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as RideRequest[]
}

export async function fetchPendingAsks(userId: string): Promise<RideOffer[]> {
  const { data, error } = await supabase
    .from('ride_offers')
    .select('*, ride_request:ride_requests(*, requester:profiles!ride_requests_requester_id_fkey(*))')
    .eq('driver_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as RideOffer[]
}

export async function fetchNotifications(userId: string): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) throw error
  return (data ?? []) as AppNotification[]
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id)
  if (error) throw error
}

export async function markAllNotificationsRead(userId: string) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false)
  if (error) throw error
}

export async function createRideRequest(
  requesterId: string,
  direction: Direction,
  shuttleDate: string,
  shuttleTime: string
): Promise<RideRequest> {
  const { data, error } = await supabase
    .from('ride_requests')
    .insert({
      requester_id: requesterId,
      direction,
      shuttle_date: shuttleDate,
      shuttle_time: shuttleTime
    })
    .select('*')
    .single()

  if (error) throw error

  try {
    await supabase.functions.invoke('notify-neighbors', {
      body: { ride_request_id: data.id }
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('notify-neighbors failed', err)
  }

  return data as RideRequest
}

export async function acceptOffer(offerId: string) {
  const { error } = await supabase.rpc('accept_ride_offer', { p_offer_id: offerId })
  if (error) throw error
}

export async function declineOffer(offerId: string) {
  const { error } = await supabase
    .from('ride_offers')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('id', offerId)
  if (error) throw error
}

export async function cancelOffer(offerId: string) {
  const { error } = await supabase.rpc('cancel_ride_offer', { p_offer_id: offerId })
  if (error) throw error
}

export async function cancelRequest(requestId: string) {
  const { error } = await supabase.rpc('cancel_ride_request', { p_request_id: requestId })
  if (error) throw error
}

export async function markCalendarAdded(offerId: string) {
  const { error } = await supabase.from('ride_offers').update({ calendar_added: true }).eq('id', offerId)
  if (error) throw error
}

export async function optOutOfReminders(offerId: string) {
  const { error } = await supabase.from('ride_offers').update({ reminder_opt_in: false }).eq('id', offerId)
  if (error) throw error
}
