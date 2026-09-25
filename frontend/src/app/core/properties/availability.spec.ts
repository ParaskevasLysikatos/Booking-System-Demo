import { BookedNights } from './availability';

const d = (day: number, month = 2) => new Date(2027, month - 1, day);

describe('BookedNights', () => {
  // A guest stays Feb 4 -> Feb 16: nights 4..15 are taken, the 16th is free again.
  const booked = new BookedNights([{ check_in: '2027-02-04', check_out: '2027-02-16' }]);

  it('marks nights [check_in, check_out) as booked', () => {
    expect(booked.size).toBe(12);
    expect(booked.isBooked(d(3))).toBe(false);
    expect(booked.isBooked(d(4))).toBe(true);
    expect(booked.isBooked(d(15))).toBe(true);
    expect(booked.isBooked(d(16))).toBe(false); // their check-out day is free
  });

  it('allows checking out on someone else\'s check-in day, and in on their check-out day', () => {
    expect(booked.isFree(d(1), d(4))).toBe(true);
    expect(booked.isFree(d(16), d(20))).toBe(true);
  });

  it('rejects any stay that touches a booked night', () => {
    expect(booked.isFree(d(1), d(5))).toBe(false);
    expect(booked.isFree(d(10), d(12))).toBe(false);
    expect(booked.isFree(d(1), d(20))).toBe(false); // spans the whole booking
  });

  it('ignores malformed ranges', () => {
    expect(new BookedNights([{ check_in: 'nope', check_out: '2027-02-16' }]).size).toBe(0);
  });
});
