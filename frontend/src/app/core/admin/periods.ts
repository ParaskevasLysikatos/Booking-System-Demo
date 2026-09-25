import { addDays, nightsBetween, parseIsoDate, todayLocal, toIsoDate } from '../dates';

/** Dashboard period presets (TICKET-023). */
export type PeriodPreset = 'this-month' | 'last-month' | 'next-month' | 'next-30' | 'last-12' | 'custom';

export interface Period {
  preset: PeriodPreset;
  from: Date;
  to: Date; // inclusive
}

export const MAX_PERIOD_DAYS = 366; // same limit as the API

export const PRESETS: { key: Exclude<PeriodPreset, 'custom'>; label: string }[] = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'next-month', label: 'Next month' },
  { key: 'next-30', label: 'Next 30 days' },
  { key: 'last-12', label: 'Last 12 months' },
];

const monthStart = (y: number, m: number) => new Date(y, m, 1);
const monthEnd = (y: number, m: number) => new Date(y, m + 1, 0);

export function presetRange(preset: Exclude<PeriodPreset, 'custom'>, today = todayLocal()): { from: Date; to: Date } {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case 'this-month':
      return { from: monthStart(y, m), to: monthEnd(y, m) };
    case 'last-month':
      return { from: monthStart(y, m - 1), to: monthEnd(y, m - 1) };
    case 'next-month':
      return { from: monthStart(y, m + 1), to: monthEnd(y, m + 1) };
    case 'next-30':
      return { from: today, to: addDays(today, 29) };
    case 'last-12':
      // 12 whole calendar months ending with the current one (<= 366 days).
      return { from: monthStart(y, m - 11), to: monthEnd(y, m) };
  }
}

/** Number of nights in an inclusive range. */
export function periodLength(from: Date, to: Date): number {
  return nightsBetween(from, to) + 1;
}

/** Exactly one whole calendar month? (1st to last day) */
function wholeMonth(from: Date, to: Date): boolean {
  return from.getDate() === 1 && to.getFullYear() === from.getFullYear() && to.getMonth() === from.getMonth()
    && to.getDate() === monthEnd(from.getFullYear(), from.getMonth()).getDate();
}

/**
 * What to compare against: the previous calendar month for a whole month
 * (so September is compared with August, even though it's a day shorter),
 * otherwise the equally long window right before.
 */
export function previousPeriod(from: Date, to: Date): { from: Date; to: Date; label: string } {
  if (wholeMonth(from, to)) {
    const prevFrom = monthStart(from.getFullYear(), from.getMonth() - 1);
    const prevTo = monthEnd(prevFrom.getFullYear(), prevFrom.getMonth());
    return { from: prevFrom, to: prevTo, label: `vs ${prevFrom.toLocaleDateString('en-GB', { month: 'long' })}` };
  }
  const days = periodLength(from, to);
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(days - 1)), to: prevTo, label: `vs previous ${days} days` };
}

/** URL <-> period. Bad or missing params fall back to "This month". */
export function parsePeriod(params: { get(name: string): string | null }, today = todayLocal()): Period {
  const preset = params.get('period') as PeriodPreset | null;
  if (preset === 'custom') {
    const from = parseIsoDate(params.get('from'));
    const to = parseIsoDate(params.get('to'));
    if (from && to && to >= from && periodLength(from, to) <= MAX_PERIOD_DAYS) return { preset, from, to };
  } else if (preset && PRESETS.some((p) => p.key === preset)) {
    return { preset, ...presetRange(preset as Exclude<PeriodPreset, 'custom'>, today) };
  }
  return { preset: 'this-month', ...presetRange('this-month', today) };
}

export function periodQueryParams(p: Period): Record<string, string | null> {
  if (p.preset === 'custom') return { period: 'custom', from: toIsoDate(p.from), to: toIsoDate(p.to) };
  return { period: p.preset === 'this-month' ? null : p.preset, from: null, to: null };
}

/** "1 – 30 Sep 2026" / "15 Aug – 14 Sep 2026" / "1 Oct 2025 – 30 Sep 2026" */
export function formatRange(from: Date, to: Date): string {
  const sameYear = from.getFullYear() === to.getFullYear();
  const sameMonth = sameYear && from.getMonth() === to.getMonth();
  const end = to.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const start = from.toLocaleDateString('en-GB', sameMonth ? { day: 'numeric' } : sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return `${start} – ${end}`;
}

// --- change vs the previous period -----------------------------------------

export interface Delta {
  /** Display text, e.g. "▲ 12%", "▼ 3.1 pts", "New", "No change". */
  text: string;
  /** For colour + screen readers: is this change good news? null = neutral. */
  good: boolean | null;
  direction: 'up' | 'down' | 'flat' | 'new';
}

/** Relative change in % (revenue, bookings, avg rate). `upIsGood` flips for e.g. cancellations. */
export function percentDelta(current: number, previous: number, upIsGood = true): Delta | null {
  if (previous === 0 && current === 0) return null; // nothing to compare
  if (previous === 0) return { text: 'New', good: upIsGood, direction: 'new' };
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.5) return { text: 'No change', good: null, direction: 'flat' };
  const up = pct > 0;
  return { text: `${up ? '▲' : '▼'} ${Math.round(Math.abs(pct))}%`, good: up === upIsGood, direction: up ? 'up' : 'down' };
}

/** Change of a rate (0..1) in percentage points - "▲ 3.2 pts". */
export function pointsDelta(current: number | null, previous: number | null): Delta | null {
  if (current === null || previous === null) return null;
  const pts = (current - previous) * 100;
  if (Math.abs(pts) < 0.05) return { text: 'No change', good: null, direction: 'flat' };
  const up = pts > 0;
  return { text: `${up ? '▲' : '▼'} ${Math.abs(pts).toFixed(1)} pts`, good: up, direction: up ? 'up' : 'down' };
}
