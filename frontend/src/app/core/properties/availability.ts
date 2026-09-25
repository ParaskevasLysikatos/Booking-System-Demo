import { addDays, parseIsoDate, toIsoDate } from '../dates';
import { BookedRange } from './property.models';

/**
 * Client-side availability rules, mirroring the backend exactly:
 * a booking occupies the nights [check_in, check_out) - so check-out day
 * itself is free, and a new guest may arrive the day another leaves.
 * These are for instant feedback in the UI; the API (and ultimately the
 * DB exclusion constraint) stays the source of truth.
 */
export class BookedNights {
  private readonly nights = new Set<string>();

  constructor(ranges: BookedRange[]) {
    for (const r of ranges) {
      const start = parseIsoDate(r.check_in);
      const end = parseIsoDate(r.check_out);
      if (!start || !end) continue;
      for (let d = start; d < end; d = addDays(d, 1)) this.nights.add(toIsoDate(d));
    }
  }

  /** Is the night starting on `date` already taken? */
  isBooked(date: Date): boolean {
    return this.nights.has(toIsoDate(date));
  }

  /** True if every night in [checkIn, checkOut) is free. */
  isFree(checkIn: Date, checkOut: Date): boolean {
    for (let d = checkIn; d < checkOut; d = addDays(d, 1)) {
      if (this.isBooked(d)) return false;
    }
    return true;
  }

  get size(): number {
    return this.nights.size;
  }
}
