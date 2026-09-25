import { convertToParamMap } from '@angular/router';

import { toIsoDate } from '../dates';
import {
  formatRange,
  parsePeriod,
  percentDelta,
  periodLength,
  periodQueryParams,
  pointsDelta,
  presetRange,
  previousPeriod,
} from './periods';

const iso = (r: { from: Date; to: Date }) => [toIsoDate(r.from), toIsoDate(r.to)];
const today = new Date(2026, 8, 25); // Fri 25 Sep 2026

describe('dashboard periods', () => {
  it('presets', () => {
    expect(iso(presetRange('this-month', today))).toEqual(['2026-09-01', '2026-09-30']);
    expect(iso(presetRange('last-month', today))).toEqual(['2026-08-01', '2026-08-31']);
    expect(iso(presetRange('next-month', today))).toEqual(['2026-10-01', '2026-10-31']);
    expect(iso(presetRange('next-30', today))).toEqual(['2026-09-25', '2026-10-24']);
    expect(iso(presetRange('last-12', today))).toEqual(['2025-10-01', '2026-09-30']);
    expect(iso(presetRange('last-month', new Date(2027, 0, 10)))).toEqual(['2026-12-01', '2026-12-31']); // year edge
  });

  it('last 12 months never exceeds the API limit, even across a leap year', () => {
    const r = presetRange('last-12', new Date(2028, 1, 15)); // Mar 2027 - Feb 2028 (leap Feb)
    expect(iso(r)).toEqual(['2027-03-01', '2028-02-29']);
    expect(periodLength(r.from, r.to)).toBe(366);
  });

  it('compares a whole month with the previous calendar month, otherwise the same-length window before', () => {
    const sep = presetRange('this-month', today);
    const prev = previousPeriod(sep.from, sep.to);
    expect(iso(prev)).toEqual(['2026-08-01', '2026-08-31']);
    expect(prev.label).toBe('vs August');
    const march = previousPeriod(new Date(2028, 2, 1), new Date(2028, 2, 31));
    expect(iso(march)).toEqual(['2028-02-01', '2028-02-29']);

    const next30 = presetRange('next-30', today);
    const p30 = previousPeriod(next30.from, next30.to);
    expect(iso(p30)).toEqual(['2026-08-26', '2026-09-24']);
    expect(p30.label).toBe('vs previous 30 days');
  });

  it('URL <-> period, falling back to this month on bad input', () => {
    const q = (o: Record<string, string>) => convertToParamMap(o);
    expect(parsePeriod(q({}), today).preset).toBe('this-month');
    expect(parsePeriod(q({ period: 'last-12' }), today).preset).toBe('last-12');
    const custom = parsePeriod(q({ period: 'custom', from: '2026-07-10', to: '2026-08-09' }), today);
    expect(iso(custom)).toEqual(['2026-07-10', '2026-08-09']);
    expect(periodQueryParams(custom)).toEqual({ period: 'custom', from: '2026-07-10', to: '2026-08-09' });
    expect(periodQueryParams(parsePeriod(q({}), today))).toEqual({ period: null, from: null, to: null });
    // reversed, too long, garbage -> this month
    for (const bad of <Record<string, string>[]>[
      { period: 'custom', from: '2026-08-09', to: '2026-07-10' },
      { period: 'custom', from: '2025-01-01', to: '2026-01-02' },
      { period: 'custom', from: 'x', to: 'y' },
      { period: 'forever' },
    ]) {
      expect(parsePeriod(q(bad), today).preset).toBe('this-month');
    }
  });

  it('formats ranges compactly', () => {
    expect(formatRange(new Date(2026, 8, 1), new Date(2026, 8, 30))).toBe('1 – 30 Sept 2026');
    expect(formatRange(new Date(2026, 7, 26), new Date(2026, 8, 24))).toBe('26 Aug – 24 Sept 2026');
    expect(formatRange(new Date(2025, 9, 1), new Date(2026, 8, 30))).toBe('1 Oct 2025 – 30 Sept 2026');
  });

  it('deltas carry direction in text, and whether it is good news', () => {
    expect(percentDelta(120, 100)).toEqual({ text: '▲ 20%', good: true, direction: 'up' });
    expect(percentDelta(80, 100)).toEqual({ text: '▼ 20%', good: false, direction: 'down' });
    expect(percentDelta(80, 100, false)?.good).toBe(true); // e.g. fewer cancellations
    expect(percentDelta(100.2, 100)?.text).toBe('No change');
    expect(percentDelta(5, 0)?.text).toBe('New');
    expect(percentDelta(0, 0)).toBeNull();
    expect(pointsDelta(0.25, 0.2)).toEqual({ text: '▲ 5.0 pts', good: true, direction: 'up' });
    expect(pointsDelta(null, 0.2)).toBeNull();
  });
});
