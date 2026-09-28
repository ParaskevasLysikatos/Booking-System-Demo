import type { ViewerReview } from '../reviews/review.models';

/** GET /api/properties/ card shape (backend listings/serializers.py:PropertyListSerializer). */
export interface PropertySummary {
  id: number;
  title: string;
  location: string;
  price_per_night: string; // decimal as string, e.g. "91.00"
  capacity: number;
  amenities: string[];
  is_active: boolean;
  cover_image: string | null;
  rating_avg: number | null;
  review_count: number;
  /** Has the logged-in caller saved it (TICKET-033)? Always false when logged out. */
  is_favorite?: boolean;
  /** How many accounts saved it - admin responses only (TICKET-033). */
  favorite_count?: number;
  /**
   * Map position (TICKET-034): exact for admins, otherwise a point 100-400 m
   * away (`location_is_approximate`), inside a `location_radius_m` circle.
   * null when the place has no position.
   */
  latitude?: number | null;
  longitude?: number | null;
  location_is_approximate?: boolean;
  location_radius_m?: number | null;
}

/** One pin from GET /api/properties/map/ (backend PropertyPinSerializer, TICKET-034). */
export interface MapPin {
  id: number;
  title: string;
  location: string;
  latitude: number;
  longitude: number;
  location_is_approximate: boolean;
  location_radius_m: number | null;
  price_per_night: string;
  capacity: number;
  is_active: boolean;
  cover_image: string | null;
  rating_avg: number | null;
  review_count: number;
  is_favorite: boolean;
}

/** GET /api/properties/map/: every stay matching the filters, not paginated. */
export interface MapPins {
  /** Matching stays with a position (= results.length unless truncated). */
  count: number;
  /** Matching stays without a position - in the list, not on the map. */
  missing_position: number;
  /** More than the API's 500-pin safety limit matched. */
  truncated: boolean;
  results: MapPin[];
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type PropertyOrdering = 'newest' | 'price' | '-price' | 'capacity' | '-capacity';

/** Everything the listings search can send - mirrors the API's query params. */
export interface PropertyFilters {
  location?: string;
  guests?: number;
  minPrice?: number;
  maxPrice?: number;
  checkIn?: Date;
  checkOut?: Date;
  ordering?: PropertyOrdering;
}

export interface PageRequest {
  page: number; // 1-based, like the API
  pageSize: number;
}

export const DEFAULT_PAGE_SIZE = 12;

export interface PropertyImage {
  id: number;
  image: string;
  is_cover: boolean;
}

/** A booked stay: nights check_in .. check_out-1 are taken ([check_in, check_out)). */
export interface BookedRange {
  check_in: string; // YYYY-MM-DD
  check_out: string;
}

export interface Availability {
  booked_ranges: BookedRange[];
  /** Only present when the request included ?check_in=&check_out=. */
  check_in?: string;
  check_out?: string;
  is_available?: boolean;
}

/** GET /api/properties/{id}/ (backend PropertyDetailSerializer). */
export interface PropertyDetail extends PropertySummary {
  description: string;
  images: PropertyImage[];
  availability: Availability;
  /** What the logged-in caller may do with reviews (TICKET-032); anonymous: false / null. */
  viewer_review?: ViewerReview;
  created_at: string;
  updated_at: string;
}

/** Longest stay the API accepts (backend bookings/serializers.py MAX_NIGHTS). */
export const MAX_NIGHTS = 30;
/** How far ahead check-in can be (backend MAX_DAYS_AHEAD). */
export const MAX_DAYS_AHEAD = 365;
