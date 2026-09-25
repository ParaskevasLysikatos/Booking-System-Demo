import { cancelDeadline, checkInMoment, formatDeadline } from './booking-policy';

describe('booking policy', () => {
  it('check-in is 15:00 local; free cancellation ends exactly 48 real hours earlier', () => {
    const checkIn = new Date(2027, 1, 5); // Fri 5 Feb 2027
    expect(checkInMoment(checkIn)).toEqual(new Date(2027, 1, 5, 15, 0));
    expect(cancelDeadline(checkIn)).toEqual(new Date(2027, 1, 3, 15, 0)); // Wed 15:00
    expect(checkInMoment(checkIn).getTime() - cancelDeadline(checkIn).getTime()).toBe(48 * 3_600_000);
  });

  it('formats like "Wed 3 Feb, 15:00"', () => {
    expect(formatDeadline(new Date(2027, 1, 3, 15, 0))).toBe('Wed 3 Feb, 15:00');
  });
});
