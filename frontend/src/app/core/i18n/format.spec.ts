import { compactEuro, bucketTitle } from '../admin/revenue-chart';
import { formatRange, pointsDelta, previousPeriod } from '../admin/periods';
import { formatDeadline } from '../bookings/booking-policy';
import { formatPrice } from '../money';
import { clockTime } from '../payments/countdown';
import { formatDate, formatNumber, formatPercent, formatTime } from './format';
import { Lang, setCurrentLang } from './locale';

/** No-break and narrow no-break spaces -> plain spaces, so expectations stay readable. */
const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('dates and money in the chosen language (TICKET-038 step 2)', () => {
  const march10 = new Date(2027, 2, 10, 15, 5);
  const inLang = (lang: Lang) => setCurrentLang(lang);

  afterEach(() => setCurrentLang('en'));

  it('every date style, English and Greek', () => {
    const rows: [Parameters<typeof formatDate>[1], string, string][] = [
      ['full', 'Wed, 10 Mar 2027', 'Τετ 10 Μαρ 2027'],
      ['medium', '10 Mar 2027', '10 Μαρ 2027'],
      ['dayMonth', '10 Mar', '10 Μαρ'],
      ['weekdayDayMonth', 'Wed 10 Mar', 'Τετ 10 Μαρ'],
      ['monthYear', 'March 2027', 'Μάρτιος 2027'],
      ['month', 'March', 'Μαρτίου'],
      ['monthShort', 'Mar', 'Μαρ'],
      ['day', '10', '10'],
      ['time', '15:05', '15:05'],
    ];
    for (const [style, en, el] of rows) {
      inLang('en');
      expect(formatDate(march10, style), `en ${style}`).toBe(en);
      inLang('el');
      expect(formatDate(march10, style), `el ${style}`).toBe(el);
    }
  });

  it("reads the API's YYYY-MM-DD as a local date (no day shift) and ISO timestamps as instants", () => {
    inLang('el');
    expect(formatDate('2027-03-10', 'full')).toBe('Τετ 10 Μαρ 2027');
    expect(formatDate(new Date(2027, 2, 10, 23, 30).toISOString(), 'medium')).toBe('10 Μαρ 2027');
    expect(formatDate('not a date')).toBe('');
  });

  it('times are 24-hour in Greek too (el-GR would say "03:05 μ.μ.")', () => {
    inLang('el');
    expect(formatTime(march10)).toBe('15:05');
    expect(clockTime(march10.toISOString())).toBe('15:05');
  });

  it('money: "€1,234.50" / "1.234,50 €", whole amounts without cents', () => {
    expect(formatPrice('91.00')).toBe('€91');
    expect(formatPrice('1234.50')).toBe('€1,234.50');
    inLang('el');
    expect(plain(formatPrice('91.00'))).toBe('91 €');
    expect(plain(formatPrice('364.00'))).toBe('364 €');
    expect(plain(formatPrice('1234.50'))).toBe('1.234,50 €');
    expect(plain(formatPrice(12345))).toBe('12.345 €');
    expect(formatPrice('abc')).toBe('');
  });

  it('numbers and percentages', () => {
    expect(formatNumber(4.7, 1)).toBe('4.7');
    expect(formatPercent(0.125)).toBe('12.5%');
    expect(formatPercent(0.4, 0)).toBe('40%');
    inLang('el');
    expect(formatNumber(4.7, 1)).toBe('4,7');
    expect(formatNumber(4, 1)).toBe('4,0');
    expect(formatNumber(12345)).toBe('12.345');
    expect(plain(formatPercent(0.125))).toBe('12,5%');
  });

  it('the booking policy deadline', () => {
    expect(formatDeadline(new Date(2026, 9, 28, 15, 0))).toBe('Wed 28 Oct, 15:00');
    inLang('el');
    expect(formatDeadline(new Date(2026, 9, 28, 15, 0))).toBe('Τετ 28 Οκτ, 15:00');
  });

  it('admin dashboard: period ranges, month names, point changes', () => {
    inLang('el');
    expect(formatRange(new Date(2026, 8, 1), new Date(2026, 8, 30))).toBe('1 – 30 Σεπ 2026');
    expect(formatRange(new Date(2026, 7, 15), new Date(2026, 8, 14))).toBe('15 Αυγ – 14 Σεπ 2026');
    expect(formatRange(new Date(2025, 9, 1), new Date(2026, 8, 30))).toBe('1 Οκτ 2025 – 30 Σεπ 2026');
    expect(previousPeriod(new Date(2026, 8, 1), new Date(2026, 8, 30)).label).toBe('έναντι Αυγούστου'); // genitive month (step 5 words)
    expect(pointsDelta(0.5, 0.375)!.text).toBe('▲ 12,5 μον.');
  });

  it('revenue chart: axis money and bucket titles', () => {
    expect([0, 80, 1500, 12000, 1_200_000].map(compactEuro)).toEqual(['€0', '€80', '€1.5k', '€12k', '€1.2M']);
    inLang('el');
    expect([0, 80, 1500, 12000, 1_200_000].map(compactEuro)).toEqual(['0 €', '80 €', '1,5k €', '12k €', '1,2M €']);
    const bucket = { from: '2026-10-05', to: '2026-10-11', nights: 7, revenue: '0', pending_revenue: '0', booked_nights: 0, pending_nights: 0 };
    expect(bucketTitle(bucket, 'week')).toBe('5 – 11 Οκτ 2026');
    expect(bucketTitle({ ...bucket, to: '2026-10-05', nights: 1 }, 'day')).toBe('Δευ 5 Οκτ 2026');
    expect(bucketTitle({ ...bucket, from: '2026-10-01', to: '2026-10-31', nights: 31 }, 'month')).toBe('Οκτώβριος 2026');
  });
});
