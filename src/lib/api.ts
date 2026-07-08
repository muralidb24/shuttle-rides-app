import { supabase } from '../supabaseClient'
import type { Direction, Profile, RideOffer, RideRequest } from '../types'
import type { User } from '@supabase/supabase-js'

export async function getOrCreateProfile(user: User): Promise<Profile> {
  const { data: existing, error: fetchError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (fetchError) throw fetchError
  if (existing) return existing as Profile

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email?.split('@')[0] ?? 'Neighbor'

  const { data: created, error: insertError } = await supabase
    .from('profiles')
    .insert({ id: user.id, email: user.email, full_name: fullName })
    .select('*')
    .single()

  if (insertError) throw insertError
  return created as Profile
}

export async function updateCalendarIntegrated(userId: string, integrated: boolean) {
  const { error } = await supabase.from('profiles').update({ calendar_integrated: integrated }).eq('id', userId)
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

  // Fan out to neighbors + send emails. Non-fatal if it fails — the request still
  // exists and neighbors can be re-notified, so we swallow errors here rather than
  // blocking the requester's flow.
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
