export type Direction = 'to_shuttle' | 'from_shuttle'

export type RideRequestStatus = 'open' | 'matched' | 'cancelled'
export type RideOfferStatus = 'pending' | 'accepted' | 'declined' | 'cancelled'

export interface Profile {
  id: string
  email: string
  full_name: string
  calendar_integrated: boolean
  created_at: string
}

export interface RideRequest {
  id: string
  requester_id: string
  direction: Direction
  shuttle_date: string // YYYY-MM-DD
  shuttle_time: string // HH:MM
  status: RideRequestStatus
  created_at: string
  requester?: Profile
}

export interface RideOffer {
  id: string
  ride_request_id: string
  driver_id: string
  status: RideOfferStatus
  calendar_added: boolean
  reminder_opt_in: boolean
  created_at: string
  responded_at: string | null
  ride_request?: RideRequest
  driver?: Profile
}
