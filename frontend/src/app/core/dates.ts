/**
 * Date-only helpers. The API speaks plain `YYYY-MM-DD` dates (no time, no
 * timezone). Never use `toISOString()` for these: it converts to UTC, so
 * midnight local time in Greece (UTC+2/+3) becomes the *previous* day.
 */

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' -> local-midnight Date, or null if it isn't a real date. */
export function parseIsoDate(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  // Reject roll-overs like 2026-02-30 -> March 2.
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

export function todayLocal(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Whole nights between two local dates (DST-safe: counts calendar days). */
export function nightsBetween(checkIn: Date, checkOut: Date): number {
  const a = Date.UTC(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate());
  const b = Date.UTC(checkOut.getFullYear(), checkOut.getMonth(), checkOut.getDate());
  return Math.round((b - a) / 86_400_000);
}
