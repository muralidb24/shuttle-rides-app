import { supabase } from '../supabaseClient'
import type { AppNotification, Community, Direction, MemberRole, Profile, RequestAudienceMode, RideOffer, RideRequest } from '../types'

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  return (data as Profile) ?? null
}

// --- Community onboarding -------------------------------------------------
// Profile creation exclusively goes through these two RPCs (there's no
// direct client insert policy on profiles or communities) - each one
// resolves/creates the community server-side and inserts the caller's own
// profile row with the correct role in a single trusted operation, so a
// client can never self-assign role='admin' or an arbitrary community_id.

export async function lookupCommunityByCode(code: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase.rpc('lookup_community_by_code', { p_code: code.trim() })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row ?? null
}

export async function joinCommunity(joinCode: string, fullName: string): Promise<Profile> {
  const { data, error } = await supabase.rpc('join_community', {
    p_join_code: joinCode.trim(),
    p_full_name: fullName.trim()
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row as Profile
}

export async function createCommunityAndJoin(name: string, joinCode: string, fullName: string): Promise<Profile> {
  const { data, error } = await supabase.rpc('create_community_and_join', {
    p_name: name.trim(),
    p_join_code: joinCode.trim(),
    p_full_name: fullName.trim()
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row as Profile
}

// --- Community admin settings ----------------------------------------------

export async function fetchCommunity(communityId: string): Promise<Community> {
  const { data, error } = await supabase.from('communities').select('*').eq('id', communityId).single()
  if (error) throw error
  return data as Community
}

export async function updateCommunity(communityId: string, updates: { name: string; join_code: string }): Promise<Community> {
  const { data, error } = await supabase
    .from('communities')
    .update(updates)
    .eq('id', communityId)
    .select('*')
    .single()
  if (error) throw error
  return data as Community
}

// RLS already scopes this to the caller's own community, so no explicit
// filter is needed here - it just returns everyone in it, self included.
export async function fetchCommunityMembers(): Promise<Profile[]> {
  const { data, error } = await supabase.from('profiles').select('*').order('full_name')
  if (error) throw error
  return (data ?? []) as Profile[]
}

export async function setMemberRole(memberId: string, role: MemberRole) {
  const { error } = await supabase.rpc('set_member_role', { p_member_id: memberId, p_role: role })
  if (error) throw error
}

export async function updateCalendarIntegrated(userId: string, integrated: boolean) {
  const { error } = await supabase.from('profiles').update({ calendar_integrated: integrated }).eq('id', userId)
  if (error) throw error
}

export async function connectCalendarFeed(userId: string, feedUrl: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ calendar_integrated: true, calendar_feed_url: feedUrl.trim() })
    .eq('id', userId)
    .select('*')
    .single()
  if (error) throw error
  return data as Profile
}

export async function disconnectCalendarFeed(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ calendar_integrated: false, calendar_feed_url: null })
    .eq('id', userId)
    .select('*')
    .single()
  if (error) throw error
  return data as Profile
}

export async function updateEmailNotificationsEnabled(userId: string, enabled: boolean) {
  const { error } = await supabase.from('profiles').update({ email_notifications_enabled: enabled }).eq('id', userId)
  if (error) throw error
}

// Registers (or re-registers) this device's push token against the signed-in
// user. `token` is globally unique (one row per device install), so this is
// an upsert on conflict(token) rather than a plain insert - covers the app
// being reinstalled or a device changing hands between community members.
export async function registerPushToken(userId: string, token: string, platform: 'ios' | 'android') {
  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { user_id: userId, token, platform, updated_at: new Date().toISOString() },
      { onConflict: 'token' }
    )
  if (error) throw error
}

// Called on sign-out so a shared/reset device stops receiving another
// person's push notifications.
export async function unregisterPushToken(token: string) {
  const { error } = await supabase.from('push_tokens').delete().eq('token', token)
  if (error) throw error
}

// Every other signed-in neighbor, for the audience-selection checklist.
export async function fetchAllProfiles(excludeUserId: string): Promise<Profile[]> {
  const { data, error } = await supabase.from('profiles').select('*').neq('id', excludeUserId).order('full_name')
  if (error) throw error
  return (data ?? []) as Profile[]
}

export async function fetchAudienceMemberIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('request_audience_members').select('member_id').eq('requester_id', userId)
  if (error) throw error
  return (data ?? []).map((row) => row.member_id as string)
}

// Replaces the requester's audience mode + selected-member list in one call.
// Not wrapped in a single DB transaction - these rows are only ever read by
// this same user's own future ride requests, so a brief window between the
// delete and the re-insert isn't a correctness or privacy issue, just a
// moment where a request created in that exact instant would fall back to
// the old selection.
export async function updateRequestAudienceSettings(
  userId: string,
  mode: RequestAudienceMode,
  memberIds: string[]
): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ request_audience_mode: mode })
    .eq('id', userId)
    .select('*')
    .single()
  if (error) throw error

  const { error: deleteError } = await supabase.from('request_audience_members').delete().eq('requester_id', userId)
  if (deleteError) throw deleteError

  if (memberIds.length > 0) {
    const { error: insertError } = await supabase
      .from('request_audience_members')
      .insert(memberIds.map((memberId) => ({ requester_id: userId, member_id: memberId })))
    if (insertError) throw insertError
  }

  return data as Profile
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
    .select('*, related_user:profiles!notifications_related_user_id_fkey(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) throw error
  return (data ?? []) as unknown as AppNotification[]
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

export async function cancelOffer(offerId: string, note?: string) {
  const { error } = await supabase.rpc('cancel_ride_offer', { p_offer_id: offerId, p_note: note ?? null })
  if (error) throw error
}

export async function cancelRequest(requestId: string, note?: string) {
  const { error } = await supabase.rpc('cancel_ride_request', { p_request_id: requestId, p_note: note ?? null })
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
