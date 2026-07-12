export type Direction = 'to_shuttle' | 'from_shuttle'

export type RideRequestStatus = 'open' | 'matched' | 'cancelled'
export type RideOfferStatus = 'pending' | 'accepted' | 'declined' | 'cancelled'
export type NotificationType = 'ride_requested' | 'ride_accepted' | 'ride_declined' | 'ride_cancelled'

export interface Profile {
  id: string
  email: string
  full_name: string
  calendar_integrated: boolean
  email_notifications_enabled: boolean
  created_at: string
}

export interface RideRequest {
  id: string
  requester_id: string
  direction: Direction
  shuttle_date: string // YYYY-MM-DD
  shuttle_time: string // HH:MM
  status: RideRequestStatus
  cancel_note: string | null
  created_at: string
  requester?: Profile
  offers?: RideOffer[]
}

export interface RideOffer {
  id: string
  ride_request_id: string
  driver_id: string
  status: RideOfferStatus
  calendar_added: boolean
  reminder_opt_in: boolean
  cancel_note: string | null
  created_at: string
  responded_at: string | null
  ride_request?: RideRequest
  driver?: Profile
}

export interface AppNotification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string
  ride_request_id: string | null
  related_user_id: string | null
  read: boolean
  created_at: string
  related_user?: Profile
}
