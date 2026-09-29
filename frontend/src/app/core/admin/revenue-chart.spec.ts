import { RevenueSeries } from './admin-stats.models';
import {
  CHART,
  axisLabel,
  bucketTitle,
  buildChart,
  columnPath,
  compactEuro,
  niceTicks,
  thinLabels,
  todayPosition,
} from './revenue-chart';
import { DAILY, bucket } from './revenue-chart.testing';

describe('niceTicks', () => {
  it('round steps from 0 up to at least the max', () => {
    expect(niceTicks(626.67)).toEqual([0, 200, 400, 600, 800]);
    expect(niceTicks(2090)).toEqual([0, 500, 1000, 1500, 2000, 2500]);
    expect(niceTicks(45)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(niceTicks(1000)).toEqual([0, 200, 400, 600, 800, 1000]); // exact max: no extra tick
    expect(niceTicks(1100)).toEqual([0, 250, 500, 750, 1000, 1250]);
  });

  it('an empty chart still gets an axis', () => {
    expect(niceTicks(0)).toEqual([0, 50, 100]);
  });
});

describe('compactEuro', () => {
  it('short axis money', () => {
    expect(compactEuro(0)).toBe('€0');
    expect(compactEuro(250)).toBe('€250');
    expect(compactEuro(1000)).toBe('€1k');
    expect(compactEuro(1500)).toBe('€1.5k');
    expect(compactEuro(12_000)).toBe('€12k');
    expect(compactEuro(1_200_000)).toBe('€1.2M');
  });
});

describe('bucketTitle', () => {
  it('day, full and partial week, full and partial month', () => {
    expect(bucketTitle(bucket('2026-10-06', '2026-10-06', 1), 'day')).toBe('Tue, 6 Oct 2026');
    expect(bucketTitle(bucket('2026-10-05', '2026-10-11', 7), 'week')).toBe('5 – 11 Oct 2026');
    expect(bucketTitle(bucket('2026-09-28', '2026-10-04', 7), 'week')).toBe('28 Sept – 4 Oct 2026');
    expect(bucketTitle(bucket('2030-01-01', '2030-01-06', 6), 'week')).toBe('1 – 6 Jan 2030 (partial week)');
    expect(bucketTitle(bucket('2030-03-31', '2030-03-31', 1), 'week')).toBe('31 Mar 2030 (partial week)');
    expect(bucketTitle(bucket('2026-10-01', '2026-10-31', 31), 'month')).toBe('October 2026');
    expect(bucketTitle(bucket('2030-01-15', '2030-01-31', 17), 'month')).toBe('15 – 31 Jan 2030 (partial month)');
  });
});

describe('axisLabel', () => {
  it('days/weeks: day number, month where it changes; months: month, year where it changes', () => {
    const a = bucket('2026-09-30', '2026-09-30', 1);
    const b = bucket('2026-10-01', '2026-10-01', 1);
    expect(axisLabel(a, null, 'day')).toEqual({ text: '30', sub: 'Sept' });
    expect(axisLabel(b, a, 'day')).toEqual({ text: '1', sub: 'Oct' });
    expect(axisLabel(bucket('2026-10-02', '2026-10-02', 1), b, 'day')).toEqual({ text: '2', sub: null });
    const dec = bucket('2025-12-01', '2025-12-31', 31);
    expect(axisLabel(dec, null, 'month')).toEqual({ text: 'Dec', sub: '2025' });
    expect(axisLabel(bucket('2026-01-01', '2026-01-31', 31), dec, 'month')).toEqual({ text: 'Jan', sub: '2026' });
  });
});

describe('columnPath', () => {
  it('rounded top corners only, square at the baseline; nothing for zero height', () => {
    expect(columnPath(10, 20, 20, 100, false)).toBe('M10,120V20H30V120Z');
    expect(columnPath(10, 20, 20, 100, true)).toBe('M10,120V24Q10,20 14,20H26Q30,20 30,24V120Z');
    expect(columnPath(10, 20, 20, 2, true)).toContain('Q10,20 12,20'); // radius clamped to the height
    expect(columnPath(10, 20, 20, 0, true)).toBe('');
  });
});

describe('buildChart', () => {
  const today = new Date(2030, 0, 3);

  it('lays out the bars: <= 24 px wide, centred in their slot, stacked with a 2 px gap', () => {
    const m = buildChart(DAILY, 600, today);
    expect(m.width).toBe(600);
    expect(m.bars.length).toBe(10);
    expect(m.ticks.map((t) => t.text)).toEqual(['€0', '€50', '€100', '€150', '€200', '€250']);
    const b0 = m.bars[0];
    expect(b0.slotWidth).toBe(60);
    expect(b0.barWidth).toBe(CHART.maxBar);
    expect(b0.barX).toBe(18);
    // 180 of a 250 axis over 220 px -> 158.4 px tall, square top (nothing stacked on it)
    expect(b0.revenuePath).toBe(columnPath(18, CHART.top + 220 - 158.4, 24, 158.4, true));
    expect(b0.expectedPath).toBe('');
    // A pending-only day: the expected segment starts at the baseline, rounded top.
    expect(m.bars[4].revenuePath).toBe('');
    expect(m.bars[4].expectedPath).toContain('Q');
  });

  it('stacks expected on top of revenue with a surface gap', () => {
    const series: RevenueSeries = { granularity: 'day', buckets: [bucket('2030-01-01', '2030-01-01', 1, '100.00', '100.00')] };
    const m = buildChart(series, 300, today);
    const top = m.ticks[m.ticks.length - 1].value; // 250
    const y = (v: number) => CHART.top + 220 - (v / top) * 220;
    const b = m.bars[0];
    expect(b.revenuePath).toBe(columnPath(b.barX, y(100), b.barWidth, y(0) - y(100), false)); // not rounded - covered
    expect(b.expectedPath).toBe(columnPath(b.barX, y(200), b.barWidth, y(100) - 2 - y(200), true));
  });

  const days = (n: number, start = '2026-09-01') =>
    Array.from({ length: n }, (_, i) => {
      const [y, m, d] = start.split('-').map(Number);
      const date = new Date(y, m - 1, d + i);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return bucket(iso, iso, 1, '10.00');
    });

  it('a whole month by day fits a phone (no scrolling); x labels are thinned out', () => {
    const m = buildChart({ granularity: 'day', buckets: days(31, '2026-10-01') }, 284, today);
    expect(m.width).toBe(284);
    const shown = m.bars.filter((b) => b.showLabel).map((b) => b.label.text);
    expect(shown).toEqual(['1', '5', '9', '13', '17', '21', '25', '29']); // every 4th at ~9 px slots
    expect(m.bars[0].label).toEqual({ text: '1', sub: 'Oct' });
    // ~9 px slots: the first/last labels are anchored inward, not clipped at the edge
    expect([m.bars[0].labelX, m.bars[0].labelAnchor]).toEqual([0, 'start']);
    expect([m.bars[30].labelX, m.bars[30].labelAnchor]).toEqual([284, 'end']);
    expect(m.bars[4].labelAnchor).toBe('middle');
  });

  it('only a long daily range scrolls on a phone: the plot gets wider instead of squeezing', () => {
    const m = buildChart({ granularity: 'day', buckets: days(62) }, 284, today);
    expect(m.width).toBe(62 * CHART.minSlot.day);
    // 12 months at 284 px still fit
    const year: RevenueSeries = {
      granularity: 'month',
      buckets: Array.from({ length: 12 }, (_, i) => bucket(`2026-${String(i + 1).padStart(2, '0')}-01`, `2026-${String(i + 1).padStart(2, '0')}-28`, 28)),
    };
    expect(buildChart(year, 284, today).width).toBe(284);
  });

  it('thinLabels: a month-start label always shows, the ones crowding it step aside', () => {
    const b = days(12, '2026-09-25'); // 25 Sep .. 6 Oct
    const labels = b.map((x, i) => axisLabel(x, i ? b[i - 1] : null, 'day'));
    // slot 10 px -> every 3rd; 1 Oct (index 6) is an anchor, so 30 Sep (index 5) and 29 (4) step aside
    const shown = thinLabels(labels, 10);
    expect(labels.filter((_, i) => shown[i]).map((l) => l.text)).toEqual(['25', '28', '1', '4']);
  });

  it('Today line: left edge of today inside its bucket, or none outside the period', () => {
    expect(buildChart(DAILY, 600, today).todayX).toBe(120); // 3rd day starts at 2 x 60
    expect(buildChart(DAILY, 600, new Date(2030, 1, 1)).todayX).toBeNull();
    const weeks: RevenueSeries = {
      granularity: 'week',
      buckets: [bucket('2030-01-01', '2030-01-06', 6), bucket('2030-01-07', '2030-01-13', 7)],
    };
    // 10 Jan = 3 nights into the 2nd week (slot 100 px) -> 100 + 3/7 x 100
    expect(todayPosition(weeks, new Date(2030, 0, 10), 100)).toBeCloseTo(142.86, 2);
  });

  it('totals, empty state and the screen-reader summary', () => {
    const m = buildChart(DAILY, 600, today);
    expect(m.totals.revenue).toBeCloseTo(626.67, 2);
    expect(m.totals.expected).toBe(300);
    expect(m.empty).toBe(false);
    expect(m.summary).toBe('Revenue by day, 10 bars: €626.67 confirmed and €300 expected. Highest: Wed, 2 Jan 2030, €213.33.');
    expect(m.bars[4].ariaLabel).toBe('Sat, 5 Jan 2030: €0 revenue, €100 expected, 0 booked nights, 1 pending');
    expect(m.bars[0].ariaLabel).toBe('Tue, 1 Jan 2030: €180 revenue, 2 booked nights');

    const empty = buildChart({ granularity: 'month', buckets: [bucket('2035-06-01', '2035-06-30', 30)] }, 600, today);
    expect(empty.empty).toBe(true);
    expect(empty.summary).toBe('Revenue by month: no revenue in this period.');
    expect(empty.ticks.map((t) => t.text)).toEqual(['€0', '€50', '€100']);
  });
});
