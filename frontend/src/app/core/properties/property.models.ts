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
  created_at: string;
  updated_at: string;
}

/** Longest stay the API accepts (backend bookings/serializers.py MAX_NIGHTS). */
export const MAX_NIGHTS = 30;
/** How far ahead check-in can be (backend MAX_DAYS_AHEAD). */
export const MAX_DAYS_AHEAD = 365;
