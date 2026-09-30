import { ClosedPeriod } from '../../../../core/admin/closed-dates.service';
import { BookedNights } from '../../../../core/properties/availability';
import { asRanges, bookingRanges, closeDateFilter, closeProblem } from './closed-dates.rules';

const d = (day: number, month = 3) => new Date(2027, month - 1, day);
const today = d(1);
const block = (id: number, start: string, end: string): ClosedPeriod => ({
  id, property: 5, start, end, nights: 0, note: '', created_by: null, created_at: '',
});

describe('closed dates rules (TICKET-045)', () => {
  const blocks = [block(1, '2027-03-10', '2027-03-13')];
  const booked = [{ check_in: '2027-03-05', check_out: '2027-03-08' }];
  // booked_ranges from the API: bookings and blocks together
  const all = [...booked, ...asRanges(blocks)];

  it('takes the closed periods back out of booked_ranges (exact matches only)', () => {
    expect(bookingRanges(all, blocks)).toEqual(booked);
    expect(bookingRanges(all, [])).toEqual(all);
  });

  it('picking the first night: free days from today to a year ahead', () => {
    const allowed = closeDateFilter(new BookedNights(all), null, null, today);
    expect(allowed(d(28, 2))).toBe(false); // yesterday
    expect(allowed(d(1))).toBe(true); // today
    expect(allowed(d(6))).toBe(false); // booked
    expect(allowed(d(8))).toBe(true); // the booking's check-out day is free
    expect(allowed(d(11))).toBe(false); // already closed
    expect(allowed(new Date(2028, 1, 29))).toBe(true); // 365 days ahead (2028 is a leap year)
    expect(allowed(new Date(2028, 2, 1))).toBe(false); // 366
    expect(allowed(null)).toBe(false);
  });

  it('picking the day it opens again: up to the next booked or closed night, which may itself be it', () => {
    const allowed = closeDateFilter(new BookedNights(all), d(8), null, today);
    expect(allowed(d(9))).toBe(true);
    expect(allowed(d(10))).toBe(true); // opens again as the next block starts
    expect(allowed(d(11))).toBe(false);
    // More than 30 nights is fine (bookings are capped at 30, closed dates aren't).
    expect(closeDateFilter(new BookedNights([]), d(1), null, today)(d(20, 5))).toBe(true);
  });

  it('checks a choice before it is sent', () => {
    const taken = new BookedNights(all);
    expect(closeProblem(null, null, taken, today)).toBe('closedDates.err.pickDates');
    expect(closeProblem(d(2), null, taken, today)).toBe('closedDates.err.pickDates');
    expect(closeProblem(d(2), d(2), taken, today)).toBe('closedDates.err.pickDates');
    expect(closeProblem(d(28, 2), d(2), taken, today)).toBe('closedDates.err.pickDates');
    expect(closeProblem(d(4), d(7), taken, today)).toBe('closedDates.err.taken');
    expect(closeProblem(d(8), d(10), taken, today)).toBeNull();
    expect(closeProblem(d(1), d(5), taken, today)).toBeNull();
  });
});
