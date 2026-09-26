import { clockTime, formatRemaining, remainingMs } from './countdown';

describe('countdown helpers', () => {
  it('remainingMs never goes negative and tolerates missing/bad input', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    expect(remainingMs('2026-10-01T12:30:00Z', now)).toBe(30 * 60_000);
    expect(remainingMs('2026-10-01T11:59:00Z', now)).toBe(0);
    expect(remainingMs(null, now)).toBe(0);
    expect(remainingMs('not a date', now)).toBe(0);
  });

  it('formats m:ss, h:mm:ss, and rounds down (never shows time that is gone)', () => {
    expect(formatRemaining(24 * 60_000 + 13_000)).toBe('24:13');
    expect(formatRemaining(59_999)).toBe('0:59');
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(3_723_000)).toBe('1:02:03');
  });

  it('clockTime is local HH:MM', () => {
    const d = new Date(2026, 9, 1, 14, 32);
    expect(clockTime(d.toISOString())).toBe('14:32');
  });
});
