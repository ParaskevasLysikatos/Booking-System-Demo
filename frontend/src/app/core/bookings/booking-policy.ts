/**
 * Booking rules the UI needs *before* a booking exists. These mirror the
 * backend settings (backend/config/settings.py): BOOKING_CHECK_IN_TIME and
 * BOOKING_GUEST_CANCELLATION_HOURS. After booking, the server's own
 * `cancel_deadline` is shown instead - it's the authoritative one.
 */
export const CHECK_IN_HOUR = 15;
export const GUEST_CANCELLATION_HOURS = 48;

/** Check-in moment: the check-in date at 15:00 local time. */
export function checkInMoment(checkIn: Date): Date {
  return new Date(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate(), CHECK_IN_HOUR, 0);
}

/** Free-cancellation deadline: exactly 48 real hours before check-in (DST-safe - ms arithmetic). */
export function cancelDeadline(checkIn: Date): Date {
  return new Date(checkInMoment(checkIn).getTime() - GUEST_CANCELLATION_HOURS * 3_600_000);
}

/** "Wed 28 Oct, 15:00" */
export function formatDeadline(date: Date): string {
  const day = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}
