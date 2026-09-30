import { addDays, nightsBetween } from '../../../../core/dates';
import { ClosedPeriod } from '../../../../core/admin/closed-dates.service';
import { BookedNights } from '../../../../core/properties/availability';
import { BookedRange, MAX_DAYS_AHEAD } from '../../../../core/properties/property.models';

/** Closed periods in the calendar's `{check_in, check_out}` shape. */
export const asRanges = (blocks: ClosedPeriod[]): BookedRange[] =>
  blocks.map((b) => ({ check_in: b.start, check_out: b.end }));

/**
 * The property's `availability.booked_ranges` holds bookings *and* closed
 * dates (guests mustn't tell them apart - TICKET-045). The admin picker
 * shows them differently, so take the closed periods back out: a booking
 * can never have exactly a block's dates (they can't overlap), so an exact
 * match is a block.
 */
export function bookingRanges(bookedRanges: BookedRange[], blocks: ClosedPeriod[]): BookedRange[] {
  return bookedRanges.filter((r) => !blocks.some((b) => b.start === r.check_in && b.end === r.check_out));
}

/** Last day a closed period may start on (backend listings/blocks.py MAX_DAYS_AHEAD). */
export const lastStart = (today: Date) => addDays(today, MAX_DAYS_AHEAD);

/**
 * Picker filter: while choosing the first night, any free day up to a year
 * ahead; once it's chosen, any later day up to the next taken night (the
 * end is exclusive, so it may itself be taken - like a check-out).
 */
export function closeDateFilter(taken: BookedNights, start: Date | null, end: Date | null, today: Date) {
  return (d: Date | null): boolean => {
    if (!d) return false;
    if (start && !end && d > start) return taken.isFree(start, d);
    return d >= today && d <= lastStart(today) && !taken.isBooked(d);
  };
}

/** Instant check before sending (null = fine); the server checks again. Returns a translation key. */
export function closeProblem(start: Date | null, end: Date | null, taken: BookedNights, today: Date): string | null {
  if (!start || !end || nightsBetween(start, end) < 1) return 'closedDates.err.pickDates';
  if (start < today || start > lastStart(today)) return 'closedDates.err.pickDates';
  if (!taken.isFree(start, end)) return 'closedDates.err.taken';
  return null;
}
