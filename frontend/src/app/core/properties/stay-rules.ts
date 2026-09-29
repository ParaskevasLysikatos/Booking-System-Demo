import { addDays, nightsBetween, todayLocal } from '../dates';
import { translate } from '../i18n/translation.service';
import { BookedNights } from './availability';
import { MAX_DAYS_AHEAD, MAX_NIGHTS } from './property.models';

/**
 * Instant client-side verdict on a chosen stay (null = fine so far),
 * mirroring the backend's validation. Shared by the detail page and the
 * booking form so both say exactly the same thing. In the chosen language
 * (TICKET-038); called from `computed()`s, so it follows a switch.
 */
export function stayProblem(
  checkIn: Date | null,
  checkOut: Date | null,
  booked: BookedNights,
  today: Date = todayLocal(),
): string | null {
  if (!checkIn && !checkOut) return null;
  if (checkIn && !checkOut) return translate('stay.pickCheckOut');
  if (!checkIn || !checkOut) return translate('stay.pickCheckIn');
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) return translate('stay.noNights');
  if (checkIn < today) return translate('stay.past');
  if (checkIn > addDays(today, MAX_DAYS_AHEAD)) return translate('stay.tooFarAhead', { days: MAX_DAYS_AHEAD });
  if (nights > MAX_NIGHTS) return translate('stay.tooLong', { nights: MAX_NIGHTS });
  if (!booked.isFree(checkIn, checkOut)) return translate('stay.booked');
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
