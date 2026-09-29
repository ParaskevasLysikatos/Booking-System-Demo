import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

import { RevenueSeries } from '../../../core/admin/admin-stats.models';
import { CHART, ChartBar, buildChart, granularityText } from '../../../core/admin/revenue-chart';
import { todayLocal } from '../../../core/dates';
import { formatPrice } from '../../../core/money';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

export const TOOLTIP_WIDTH = 200; // = .tooltip width in the SCSS
const TOOLTIP_GAP = 8;

/**
 * Tooltip x inside the plot area: beside the bar so it never covers it -
 * to the right if it fits, else to the left, else (a narrow phone) as far
 * left as possible without leaving the card.
 */
export function tooltipLeft(barLeft: number, barWidth: number, areaWidth: number): number {
  const right = barLeft + barWidth + TOOLTIP_GAP;
  if (right + TOOLTIP_WIDTH <= areaWidth) return right;
  const left = barLeft - TOOLTIP_GAP - TOOLTIP_WIDTH;
  if (left >= 0) return left;
  return Math.max(0, Math.min(right, areaWidth - TOOLTIP_WIDTH));
}

/**
 * "Revenue over time" on the admin dashboard (TICKET-035): confirmed revenue
 * as columns with the expected (pending) revenue stacked on top, one column
 * per day / week / month (the backend picks the size). Hand-built SVG - the
 * maths lives in core/admin/revenue-chart.ts.
 *
 * - Hover or focus a column for its tooltip; arrow keys / Home / End move
 *   between columns, Esc hides the tooltip.
 * - A "Today" line when the period includes today.
 * - The whole period fits the card (a month by day fits a phone). Only a
 *   long daily range (40-62 days) on a phone scrolls sideways inside the
 *   card, with the y axis staying put.
 * - A Table view with every number (the light "expected" colour is below 3:1
 *   contrast, so the values must be readable without the colours too).
 */
@Component({
  selector: 'app-revenue-chart',
  imports: [MatButtonToggleModule, TranslatePipe],
  templateUrl: './revenue-chart.html',
  styleUrl: './revenue-chart.scss',
})
export class RevenueChartComponent {
  readonly series = input.required<RevenueSeries>();
  /** Injectable for tests; the admin's local today by default. */
  readonly today = input<Date>(todayLocal());

  readonly chart = CHART;
  readonly svgHeight = CHART.top + CHART.plotHeight + CHART.axisHeight;
  readonly baseline = CHART.top + CHART.plotHeight;

  readonly view = signal<'chart' | 'table'>('chart');
  /** Visible plot width (the area minus the y axis), kept up to date by a ResizeObserver. */
  readonly plotWidth = signal(600);
  /** The column under the pointer or keyboard focus (tooltip + highlight). */
  readonly active = signal<number | null>(null);
  /** The column that takes Tab (roving tabindex). */
  readonly focusIndex = signal(0);

  readonly model = computed(() => buildChart(this.series(), this.plotWidth(), this.today()));
  /** The plot is wider than the card (a long daily range on a phone). */
  readonly scrolls = computed(() => this.model().width > this.plotWidth() + 1);
  readonly granularityText = computed(() => granularityText(this.series().granularity));
  readonly activeBar = computed(() => {
    const i = this.active();
    return i === null ? null : (this.model().bars[i] ?? null);
  });
  readonly totalNights = computed(() =>
    this.series().buckets.reduce(
      (t, b) => ({ booked: t.booked + b.booked_nights, pending: t.pending + b.pending_nights }),
      { booked: 0, pending: 0 },
    ),
  );
  /** Tooltip x, relative to the plot area (clamped so it never leaves the card). */
  readonly tooltipLeft = signal(0);

  private readonly area = viewChild<ElementRef<HTMLElement>>('area');
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly injector = inject(Injector);

  constructor() {
    const destroyRef = inject(DestroyRef);
    let observer: ResizeObserver | undefined;

    // Measure the plot area whenever the chart view is (re)shown.
    effect(() => {
      const el = this.area()?.nativeElement;
      observer?.disconnect();
      if (!el) return;
      const measure = () => {
        const w = el.clientWidth - CHART.yAxisWidth;
        if (w > 0) this.plotWidth.set(Math.floor(w));
      };
      measure();
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure);
        observer.observe(el);
      }
    });
    destroyRef.onDestroy(() => observer?.disconnect());

    // A new period: forget the old highlight and, if the plot scrolls, start
    // at the beginning of the period. (Only on a new series - a resize must
    // not reset the scroll.)
    effect(() => {
      this.series();
      untracked(() => {
        this.active.set(null);
        this.focusIndex.set(0);
      });
      afterNextRender(
        () => {
          const s = this.scroller()?.nativeElement;
          if (s) s.scrollLeft = 0;
        },
        { injector: this.injector },
      );
    });
  }

  money(v: number | string): string {
    return formatPrice(typeof v === 'number' ? Math.round(v * 100) / 100 : v);
  }

  show(bar: ChartBar): void {
    this.active.set(bar.index);
    const scroll = this.scroller()?.nativeElement.scrollLeft ?? 0;
    const areaWidth = this.area()?.nativeElement.clientWidth ?? this.plotWidth() + CHART.yAxisWidth;
    this.tooltipLeft.set(tooltipLeft(CHART.yAxisWidth + bar.barX - scroll, bar.barWidth, areaWidth));
  }

  hide(): void {
    this.active.set(null);
  }

  onFocus(bar: ChartBar): void {
    this.focusIndex.set(bar.index);
    this.show(bar);
  }

  onBlur(): void {
    // Let the next focus (arrow key) land first; only hide when focus left the chart.
    queueMicrotask(() => {
      if (!this.host.nativeElement.contains(document.activeElement)) this.hide();
    });
  }

  onKeydown(event: KeyboardEvent, bar: ChartBar): void {
    const last = this.model().bars.length - 1;
    const next =
      event.key === 'ArrowRight' ? Math.min(last, bar.index + 1)
      : event.key === 'ArrowLeft' ? Math.max(0, bar.index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    if (event.key === 'Escape') {
      this.hide();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    this.focusIndex.set(next);
    const target = this.host.nativeElement.querySelector<SVGElement>(`[data-bar="${next}"]`);
    target?.focus();
  }

  setView(view: 'chart' | 'table'): void {
    this.hide();
    this.view.set(view);
  }
}
