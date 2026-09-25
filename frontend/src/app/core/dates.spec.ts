import { addDays, nightsBetween, parseIsoDate, toIsoDate } from './dates';

describe('date helpers', () => {
  it('formats the LOCAL date (no UTC shift)', () => {
    // Local midnight - toISOString() would give the previous day east of UTC.
    expect(toIsoDate(new Date(2026, 10, 2))).toBe('2026-11-02');
    expect(toIsoDate(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
  });

  it('parses real dates and rejects roll-overs/garbage', () => {
    expect(toIsoDate(parseIsoDate('2026-11-02')!)).toBe('2026-11-02');
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('02/11/2026')).toBeNull();
    expect(parseIsoDate(null)).toBeNull();
  });

  it('counts nights by calendar day, even across a DST change', () => {
    expect(nightsBetween(new Date(2026, 10, 2), new Date(2026, 10, 7))).toBe(5);
    expect(nightsBetween(new Date(2026, 9, 24), new Date(2026, 9, 26))).toBe(2); // EU clocks go back Oct 25
    expect(toIsoDate(addDays(new Date(2026, 11, 30), 3))).toBe('2027-01-02');
  });
});
