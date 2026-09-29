/** Test data for the revenue chart specs (TICKET-035) - test-only, never imported by app code. */
import { RevenueBucket, RevenueSeries } from './admin-stats.models';

export const bucket = (from: string, to: string, nights: number, revenue = '0.00', pending = '0.00', booked = 0, pendingNights = 0): RevenueBucket => ({
  from, to, nights, revenue, pending_revenue: pending, booked_nights: booked, pending_nights: pendingNights,
});

/** The backend's hand-worked AdminStatsSeriesTests data: 1-10 Jan 2030, by day. */
export const DAILY: RevenueSeries = {
  granularity: 'day',
  buckets: [
    ['180.00', '0.00', 2, 0], ['213.33', '0.00', 3, 0], ['33.34', '0.00', 1, 0], ['33.33', '0.00', 1, 0],
    ['0.00', '100.00', 0, 1], ['0.00', '100.00', 0, 1], ['0.00', '100.00', 0, 1], ['0.00', '0.00', 0, 0],
    ['33.33', '0.00', 1, 0], ['133.34', '0.00', 2, 0],
  ].map(([rev, pend, booked, pn], i) => {
    const d = `2030-01-${String(i + 1).padStart(2, '0')}`;
    return bucket(d, d, 1, rev as string, pend as string, booked as number, pn as number);
  }),
};
