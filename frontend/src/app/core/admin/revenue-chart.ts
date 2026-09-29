/**
 * Pure helpers behind the dashboard's revenue chart (TICKET-035):
 * y-axis ticks, labels and the chart's geometry. No Angular, no DOM, so
 * every number the chart draws can be unit-tested on its own.
 */
import { addDays, nightsBetween, parseIsoDate } from '../dates';
import { formatPrice } from '../money';
import { formatDate, formatNumber } from '../i18n/format';
import { currentLang } from '../i18n/locale';
import { RevenueBucket, RevenueSeries, SeriesGranularity } from './admin-stats.models';

// --- y axis -------------------------------------------------------------

/**
 * Round tick values from 0 up to at least `max`: steps of 1, 2, 2.5 or 5
 * x 10^n, aiming for about `target` intervals (4-6 in practice). An empty chart (max 0)
 * still gets an axis (0 / 50 / 100).
 */
export function niceTicks(max: number, target = 5): number[] {
  if (!(max > 0)) return [0, 50, 100];
  const rough = max / target;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough)!;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 1e-9; v += step) ticks.push(round2(v));
  if (ticks[ticks.length - 1] < max) ticks.push(round2(ticks[ticks.length - 1] + step));
  return ticks;
}

/**
 * Axis money, short enough for a narrow axis: €0, €80, €500, €1.5k, €12k,
 * €1.2M - in Greek 0 €, 1,5k €, 1,2M € (decimal comma, € after; kept to "k"/"M"
 * rather than Intl's "1,5 χιλ. €", which is too wide for a phone's axis).
 */
export function compactEuro(value: number): string {
  const [n, unit] = value >= 1_000_000 ? [value / 1_000_000, 'M'] : value >= 1_000 ? [value / 1_000, 'k'] : [value, ''];
  const amount = `${trim(n)}${unit}`;
  return currentLang() === 'el' ? `${amount} €` : `€${amount}`;
}

/** At most one decimal, in the chosen language: 1.5 -> "1.5" / "1,5"; 2 -> "2". */
function trim(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return formatNumber(rounded, Number.isInteger(rounded) ? 0 : 1).replace(/\s/g, '');
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// --- labels -------------------------------------------------------------

// Dates in the chosen language (TICKET-038): core/i18n/format.ts styles
// dayMonth "6 Oct", medium "6 Oct 2026", full "Tue, 6 Oct 2026",
// monthShort "Oct", monthYear "October 2026".

export const GRANULARITY_TEXT: Record<SeriesGranularity, string> = { day: 'By day', week: 'By week', month: 'By month' };

/**
 * The bucket's full name for the tooltip and the table:
 * day "Tue 6 Oct 2026"; week "5 – 11 Oct 2026"; month "October 2026";
 * a cut-off first/last week or month shows its real dates + "(partial)".
 */
export function bucketTitle(b: RevenueBucket, granularity: SeriesGranularity): string {
  const from = parseIsoDate(b.from)!;
  const to = parseIsoDate(b.to)!;
  if (granularity === 'day') return formatDate(from, 'full');
  const full = granularity === 'week' ? b.nights === 7 : from.getDate() === 1 && addDays(to, 1).getDate() === 1;
  if (granularity === 'month' && full) return formatDate(from, 'monthYear');
  const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  const range =
    b.from === b.to
      ? formatDate(from, 'medium')
      : `${sameMonth ? from.getDate() : formatDate(from, 'dayMonth')} – ${formatDate(to, 'medium')}`;
  return full ? range : `${range} (partial ${granularity})`;
}

/** Two-line x-axis label: `text` under the bar, `sub` (month / year) where it changes. */
export interface AxisLabel {
  text: string;
  sub: string | null;
}

export function axisLabel(b: RevenueBucket, prev: RevenueBucket | null, granularity: SeriesGranularity): AxisLabel {
  const from = parseIsoDate(b.from)!;
  const before = prev ? parseIsoDate(prev.from)! : null;
  if (granularity === 'month') {
    const newYear = !before || before.getFullYear() !== from.getFullYear();
    return { text: formatDate(from, 'monthShort'), sub: newYear ? String(from.getFullYear()) : null };
  }
  const newMonth = !before || before.getMonth() !== from.getMonth();
  return { text: String(from.getDate()), sub: newMonth ? formatDate(from, 'monthShort') : null };
}

// --- geometry -----------------------------------------------------------

export const CHART = {
  plotHeight: 220, // px, the bars' area
  top: 18, // room for the "Today" label and the top tick's text
  axisHeight: 36, // two lines of x labels
  yAxisWidth: 48,
  maxBar: 24, // mark spec: bars <= 24 px
  gap: 2, // surface gap between the stacked segments
  radius: 4, // rounded data-end
  // Narrowest slot per bar. Small enough that a whole month by day (31) or
  // any week/month series fits a phone - an overview must show the whole
  // period at once; only a long daily range (40-62 days) scrolls on a phone.
  minSlot: { day: 9, week: 12, month: 20 } as Record<SeriesGranularity, number>,
  minLabelGap: 30, // px between x labels before they are thinned out
};

export interface ChartBar {
  index: number;
  bucket: RevenueBucket;
  title: string;
  revenue: number;
  expected: number;
  label: AxisLabel;
  showLabel: boolean;
  /** Label position: under the slot's centre, pulled inward at the plot's edges so it isn't clipped. */
  labelX: number;
  labelAnchor: 'start' | 'middle' | 'end';
  /** Slot (hit target) and bar geometry, in px inside the scrolling plot. */
  slotX: number;
  slotWidth: number;
  barX: number;
  barWidth: number;
  /** SVG paths (empty string = nothing to draw). */
  revenuePath: string;
  expectedPath: string;
  /** For screen readers / the focused bar. */
  ariaLabel: string;
}

/** Half the widest x label ("Sept", "2026") - closer to an edge than this, the label is anchored inward. */
const EDGE_ROOM = 14;

export interface ChartModel {
  granularity: SeriesGranularity;
  width: number; // total plot width (may exceed the visible width -> scrolls)
  ticks: { value: number; y: number; text: string }[];
  bars: ChartBar[];
  todayX: number | null;
  empty: boolean;
  totals: { revenue: number; expected: number };
  summary: string;
}

/**
 * Lays the series out for a plot `availableWidth` px wide (the y axis sits
 * outside it). Bars get at least `CHART.minSlot` px each; if they don't fit,
 * the plot gets wider and scrolls sideways inside its card.
 */
export function buildChart(series: RevenueSeries, availableWidth: number, today: Date): ChartModel {
  const g = series.granularity;
  const n = series.buckets.length;
  const width = Math.max(availableWidth, n * CHART.minSlot[g]);
  const slot = n ? width / n : width;
  const barWidth = Math.min(CHART.maxBar, Math.max(4, slot * 0.62));

  const values = series.buckets.map((b) => ({ revenue: Number(b.revenue), expected: Number(b.pending_revenue) }));
  const max = Math.max(0, ...values.map((v) => v.revenue + v.expected));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => CHART.top + CHART.plotHeight - (v / top) * CHART.plotHeight;

  const labels = series.buckets.map((b, i) => axisLabel(b, i ? series.buckets[i - 1] : null, g));
  const shown = thinLabels(labels, slot);

  const bars = series.buckets.map((b, i): ChartBar => {
    const { revenue, expected } = values[i];
    const slotX = i * slot;
    const barX = slotX + (slot - barWidth) / 2;
    const base = y(0);
    const revTop = y(revenue);
    const expTop = y(revenue + expected);
    const hasRev = revenue > 0;
    const hasExp = expected > 0;
    // Stack: confirmed from the baseline, a 2 px surface gap, then expected.
    // Only the topmost segment gets the rounded data-end.
    const revenuePath = hasRev ? columnPath(barX, revTop, barWidth, base - revTop, !hasExp) : '';
    const expBase = hasRev ? revTop - CHART.gap : base;
    const expectedPath = hasExp ? columnPath(barX, expTop, barWidth, Math.max(0, expBase - expTop), true) : '';
    const title = bucketTitle(b, g);
    const centre = slotX + slot / 2;
    const [labelX, labelAnchor] =
      centre < EDGE_ROOM ? [0, 'start' as const]
      : centre > width - EDGE_ROOM ? [width, 'end' as const]
      : [centre, 'middle' as const];
    return {
      index: i,
      bucket: b,
      title,
      revenue,
      expected,
      label: labels[i],
      showLabel: shown[i],
      labelX,
      labelAnchor,
      slotX,
      slotWidth: slot,
      barX,
      barWidth,
      revenuePath,
      expectedPath,
      ariaLabel: barAriaLabel(title, b),
    };
  });

  const totals = values.reduce((t, v) => ({ revenue: t.revenue + v.revenue, expected: t.expected + v.expected }), {
    revenue: 0,
    expected: 0,
  });

  return {
    granularity: g,
    width,
    ticks: ticks.map((v) => ({ value: v, y: y(v), text: compactEuro(v) })),
    bars,
    todayX: todayPosition(series, today, slot),
    empty: max === 0,
    totals,
    summary: chartSummary(series, bars, totals),
  };
}

/**
 * Which x labels to draw so they're at least `minLabelGap` px apart. Labels
 * that start a month (days/weeks) or a year (months) always show - they
 * carry the second line - and the others step aside for them.
 */
export function thinLabels(labels: AxisLabel[], slot: number): boolean[] {
  const every = Math.max(1, Math.ceil(CHART.minLabelGap / slot));
  const anchors = labels.map((l, i) => (l.sub ? i : -1)).filter((i) => i >= 0);
  let last = -Infinity;
  return labels.map((l, i) => {
    if (l.sub) {
      last = i;
      return true;
    }
    const nextAnchor = anchors.find((a) => a > i) ?? Infinity;
    const ok = i - last >= every && nextAnchor - i >= every;
    if (ok) last = i;
    return ok;
  });
}

/** A column with only its top corners rounded (square at the baseline). */
export function columnPath(x: number, top: number, w: number, h: number, rounded: boolean): string {
  if (h <= 0) return '';
  const r = rounded ? Math.min(CHART.radius, h, w / 2) : 0;
  const bottom = top + h;
  const f = (v: number) => Math.round(v * 100) / 100;
  if (!r) return `M${f(x)},${f(bottom)}V${f(top)}H${f(x + w)}V${f(bottom)}Z`;
  return (
    `M${f(x)},${f(bottom)}V${f(top + r)}Q${f(x)},${f(top)} ${f(x + r)},${f(top)}` +
    `H${f(x + w - r)}Q${f(x + w)},${f(top)} ${f(x + w)},${f(top + r)}V${f(bottom)}Z`
  );
}

/**
 * Where "Today" goes: the left edge of today's night inside its bucket
 * (a day bucket -> its left edge; a week/month -> proportionally inside).
 * null when today is outside the period.
 */
export function todayPosition(series: RevenueSeries, today: Date, slot: number): number | null {
  for (const [i, b] of series.buckets.entries()) {
    const from = parseIsoDate(b.from)!;
    const to = parseIsoDate(b.to)!;
    if (today >= from && today <= to) {
      return i * slot + (nightsBetween(from, today) / b.nights) * slot;
    }
  }
  return null;
}

export function barAriaLabel(title: string, b: RevenueBucket): string {
  const parts = [`${formatPrice(b.revenue)} revenue`];
  if (Number(b.pending_revenue) > 0) parts.push(`${formatPrice(b.pending_revenue)} expected`);
  parts.push(`${b.booked_nights} booked ${b.booked_nights === 1 ? 'night' : 'nights'}`);
  if (b.pending_nights) parts.push(`${b.pending_nights} pending`);
  return `${title}: ${parts.join(', ')}`;
}

function chartSummary(series: RevenueSeries, bars: ChartBar[], totals: { revenue: number; expected: number }): string {
  const unit = { day: 'day', week: 'week', month: 'month' }[series.granularity];
  if (!bars.length || (totals.revenue === 0 && totals.expected === 0)) {
    return `Revenue by ${unit}: no revenue in this period.`;
  }
  const best = bars.reduce((a, b) => (b.revenue + b.expected > a.revenue + a.expected ? b : a));
  let text = `Revenue by ${unit}, ${bars.length} bars: ${formatPrice(round2(totals.revenue))} confirmed`;
  if (totals.expected > 0) text += ` and ${formatPrice(round2(totals.expected))} expected`;
  return `${text}. Highest: ${best.title}, ${formatPrice(round2(best.revenue + best.expected))}.`;
}
