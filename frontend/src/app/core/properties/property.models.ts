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
