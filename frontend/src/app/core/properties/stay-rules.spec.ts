import { BookedNights } from './availability';
import { stayDateFilter, stayProblem } from './stay-rules';

const today = new Date(2027, 0, 1);
const d = (day: number, month = 2) => new Date(2027, month - 1, day);
const booked = new BookedNights([{ check_in: '2027-02-04', check_out: '2027-02-16' }]);

describe('stay rules', () => {
  it('explains what is wrong with a stay (same wording everywhere)', () => {
    expect(stayProblem(null, null, booked, today)).toBeNull();
    expect(stayProblem(d(1), null, booked, today)).toBe('Pick a check-out date.');
    expect(stayProblem(d(2), d(2), booked, today)).toBe('Check-out must be after check-in.');
    expect(stayProblem(new Date(2026, 11, 30), d(1, 1), booked, today)).toBe("Check-in can't be in the past.");
    expect(stayProblem(new Date(2028, 1, 1), new Date(2028, 1, 2), booked, today)).toBe('Bookings open at most 365 days ahead.');
    expect(stayProblem(d(16), d(20, 3), booked, today)).toBe('A stay can be at most 30 nights.');
    expect(stayProblem(d(1), d(5), booked, today)).toBe('Some of these nights are already booked.');
    expect(stayProblem(d(1), d(4), booked, today)).toBeNull();
  });

  it('date filter: free check-in nights; then only check-outs that keep the stay free', () => {
    expect(stayDateFilter(booked, null, null)(d(4))).toBe(false);
    expect(stayDateFilter(booked, null, null)(d(16))).toBe(true);
    const pickingEnd = stayDateFilter(booked, d(1), null);
    expect(pickingEnd(d(4))).toBe(true);
    expect(pickingEnd(d(5))).toBe(false);
  });
});
