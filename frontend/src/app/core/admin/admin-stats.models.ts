/** GET /api/admin/stats/ (backend bookings/stats.py:compute_stats). */
export interface AdminStats {
  period: { from: string; to: string; nights: number };
  bookings: {
    total: number;
    pending: number;
    confirmed: number;
    cancelled: number;
    created_in_period: number;
  };
  occupancy: {
    rate: number | null; // 0..1, null when there are no active properties
    booked_nights: number;
    pending_nights: number;
    available_nights: number; // active properties x nights - closed_nights
    closed_nights: number; // TICKET-045: closed by an admin, left out of occupancy
    active_properties: number;
  };
  revenue: { confirmed: string; pending: string }; // decimals as strings
  properties: PropertyStats[];
  /** Revenue over time for the dashboard chart (TICKET-035). */
  series: RevenueSeries;
}

export type SeriesGranularity = 'day' | 'week' | 'month';

/** Buckets cover the period without gaps; the first/last can be partial. */
export interface RevenueSeries {
  granularity: SeriesGranularity;
  buckets: RevenueBucket[];
}

export interface RevenueBucket {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
  nights: number;
  revenue: string; // confirmed, decimal string; buckets add up to revenue.confirmed exactly
  pending_revenue: string; // expected; add up to revenue.pending
  booked_nights: number; // all properties incl. retired
  pending_nights: number;
}

export interface PropertyStats {
  id: number;
  title: string;
  is_active: boolean;
  booked_nights: number;
  pending_nights: number;
  closed_nights: number; // TICKET-045
  occupancy_rate: number | null; // booked / (period nights - closed_nights)
  revenue: string;
  pending_revenue: string;
}
