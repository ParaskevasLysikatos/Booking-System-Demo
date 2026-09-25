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
    available_nights: number;
    active_properties: number;
  };
  revenue: { confirmed: string; pending: string }; // decimals as strings
  properties: PropertyStats[];
}

export interface PropertyStats {
  id: number;
  title: string;
  is_active: boolean;
  booked_nights: number;
  pending_nights: number;
  occupancy_rate: number | null;
  revenue: string;
  pending_revenue: string;
}
