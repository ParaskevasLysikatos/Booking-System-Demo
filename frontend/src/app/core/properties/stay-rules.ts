import { addDays, nightsBetween, todayLocal } from '../dates';
import { BookedNights } from './availability';
import { MAX_DAYS_AHEAD, MAX_NIGHTS } from './property.models';

/**
 * Instant client-side verdict on a chosen stay (null = fine so far),
 * mirroring the backend's validation. Shared by the detail page and the
 * booking form so both say exactly the same thing.
 */
export function stayProblem(
  checkIn: Date | null,
  checkOut: Date | null,
  booked: BookedNights,
  today: Date = todayLocal(),
): string | null {
  if (!checkIn && !checkOut) return null;
  if (checkIn && !checkOut) return 'Pick a check-out date.';
  if (!checkIn || !checkOut) return 'Pick a check-in date.';
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) return 'Check-out must be after check-in.';
  if (checkIn < today) return "Check-in can't be in the past.";
  if (checkIn > addDays(today, MAX_DAYS_AHEAD)) return `Bookings open at most ${MAX_DAYS_AHEAD} days ahead.`;
  if (nights > MAX_NIGHTS) return `A stay can be at most ${MAX_NIGHTS} nights.`;
  if (!booked.isFree(checkIn, checkOut)) return 'Some of these nights are already booked.';
  return null;
}

/** Date filter for pickers: booked check-in nights off; valid check-outs only once a check-in is chosen. */
export function stayDateFilter(booked: BookedNights, start: Date | null, end: Date | null) {
  return (d: Date | null): boolean => {
    if (!d) return false;
    if (start && !end && d > start) return nightsBetween(start, d) <= MAX_NIGHTS && booked.isFree(start, d);
    return !booked.isBooked(d);
  };
}
