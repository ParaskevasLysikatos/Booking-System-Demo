/** Shapes of the Bookings API (backend bookings/serializers.py). */

import { PaymentSummary } from '../payments/payment.models';
import type { MyReview } from '../reviews/review.models';

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled';

export interface BookingPropertySummary {
  id: number;
  title: string;
  location: string;
  price_per_night: string;
  cover_image: string | null;
}

/** Read shape returned by every bookings endpoint. */
export interface Booking {
  id: number;
  property: BookingPropertySummary;
  check_in: string; // YYYY-MM-DD
  check_out: string;
  nights: number;
  guests: number;
  total_price: string; // computed by the server
  status: BookingStatus;
  can_cancel: boolean;
  cancel_deadline: string; // ISO datetime, local time with offset
  /** Online payment (TICKET-029); null/absent = this booking doesn't take online payment. */
  payment?: PaymentSummary | null;
  /** TICKET-032: my booking, confirmed, checked out, and I haven't reviewed the place yet. */
  can_review?: boolean;
  /** TICKET-032: my review of this booking's property (from any of my stays there). */
  my_review?: MyReview | null;
  guest_email: string | null; // admins only
  created_at: string;
}

/** Query for GET /api/bookings/ (see backend BookingFilterSerializer). */
export interface BookingListQuery {
  when?: 'upcoming' | 'past';
  statuses?: BookingStatus[];
  /** Only the caller's own bookings - even for an admin (My Bookings). */
  mine?: boolean;
  /** Admin only: guest email or property title (ignored by the API for guests). */
  search?: string;
  /** Admin only: one property's bookings. */
  property?: number;
  page?: number;
  pageSize?: number;
}

/** POST /api/bookings/ body - price/status/guest are decided by the server. */
export interface CreateBookingRequest {
  property: number;
  check_in: string;
  check_out: string;
  guests: number;
}
