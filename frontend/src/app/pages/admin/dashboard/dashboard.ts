import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, forkJoin, map, of, startWith, switchMap } from 'rxjs';

import { AdminStats } from '../../../core/admin/admin-stats.models';
import { AdminStatsService } from '../../../core/admin/admin-stats.service';
import {
  Delta,
  MAX_PERIOD_DAYS,
  Period,
  PeriodPreset,
  PRESETS,
  formatRange,
  parsePeriod,
  percentDelta,
  periodLength,
  periodQueryParams,
  pointsDelta,
  previousPeriod,
} from '../../../core/admin/periods';
import { addDays } from '../../../core/dates';
import { formatPrice } from '../../../core/money';
import { PropertyBreakdownComponent } from './property-breakdown';

type DashState =
  | { status: 'loading' }
  | { status: 'ok'; current: AdminStats; previous: AdminStats | null }
  | { status: 'error' };

/** Everything the cards show, derived from the two stats responses. */
export interface DashboardCards {
  revenue: string;
  revenueExpected: string | null;
  revenueDelta: Delta | null;
  occupancyPct: string;
  occupancyWidth: number;
  occupancyDetail: string;
  pendingNights: number;
  occupancyDelta: Delta | null;
  stays: number;
  confirmed: number;
  pending: number;
  cancelled: number;
  createdInPeriod: number;
  staysDelta: Delta | null;
  avgNight: string | null;
  avgNightDelta: Delta | null;
  empty: boolean;
}

/** Revenue per booked night (ADR), over all properties that earned in the period. */
function avgPerNight(s: AdminStats): number | null {
  const nights = s.properties.reduce((sum, p) => sum + p.booked_nights, 0);
  return nights ? Number(s.revenue.confirmed) / nights : null;
}

export function buildCards(cur: AdminStats, prev: AdminStats | null): DashboardCards {
  const rate = cur.occupancy.rate;
  const stays = cur.bookings.confirmed + cur.bookings.pending;
  const expected = Number(cur.revenue.pending);
  const adr = avgPerNight(cur);
  const prevAdr = prev ? avgPerNight(prev) : null;
  return {
    revenue: formatPrice(cur.revenue.confirmed),
    revenueExpected: expected > 0 ? formatPrice(expected) : null,
    revenueDelta: prev ? percentDelta(Number(cur.revenue.confirmed), Number(prev.revenue.confirmed)) : null,
    occupancyPct: rate === null ? '–' : `${(rate * 100).toFixed(1)}%`,
    occupancyWidth: (rate ?? 0) * 100,
    occupancyDetail:
      `${cur.occupancy.booked_nights} of ${cur.occupancy.available_nights} nights booked · ` +
      `${cur.occupancy.active_properties} active ${cur.occupancy.active_properties === 1 ? 'property' : 'properties'}`,
    pendingNights: cur.occupancy.pending_nights,
    occupancyDelta: prev ? pointsDelta(rate, prev.occupancy.rate) : null,
    stays,
    confirmed: cur.bookings.confirmed,
    pending: cur.bookings.pending,
    cancelled: cur.bookings.cancelled,
    createdInPeriod: cur.bookings.created_in_period,
    staysDelta: prev ? percentDelta(stays, prev.bookings.confirmed + prev.bookings.pending) : null,
    avgNight: adr === null ? null : formatPrice(Math.round(adr * 100) / 100),
    avgNightDelta: adr !== null && prevAdr !== null ? percentDelta(adr, prevAdr) : null,
    empty: cur.bookings.total === 0,
  };
}

/** /admin/dashboard (TICKET-023) - stat cards + per-property breakdown for a chosen period. */
@Component({
  selector: 'app-admin-dashboard',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    PropertyBreakdownComponent,
  ],
  providers: [provideNativeDateAdapter(), { provide: MAT_DATE_LOCALE, useValue: 'en-GB' }],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class AdminDashboardPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly stats = inject(AdminStatsService);

  readonly presets = PRESETS;
  readonly maxDays = MAX_PERIOD_DAYS;

  /** The period lives in the URL (?period=last-month, or ?period=custom&from=&to=). */
  private readonly period$ = this.route.queryParamMap.pipe(map((q) => parsePeriod(q)));
  readonly period = toSignal(this.period$, { requireSync: true });
  readonly comparison = computed(() => previousPeriod(this.period().from, this.period().to));
  readonly rangeText = computed(() => formatRange(this.period().from, this.period().to));
  readonly nights = computed(() => periodLength(this.period().from, this.period().to));

  private readonly retry$ = new BehaviorSubject<void>(undefined);

  readonly state = toSignal(
    combineLatest([this.period$, this.retry$]).pipe(
      switchMap(([p]) => {
        const prev = previousPeriod(p.from, p.to);
        return forkJoin({
          current: this.stats.getStats(p.from, p.to),
          // The comparison is a nice-to-have: if it fails, show the numbers without deltas.
          previous: this.stats.getStats(prev.from, prev.to).pipe(catchError(() => of(null))),
        }).pipe(
          map(({ current, previous }): DashState => ({ status: 'ok', current, previous })),
          catchError(() => of<DashState>({ status: 'error' })),
          startWith<DashState>({ status: 'loading' }),
        );
      }),
    ),
    { initialValue: { status: 'loading' } as DashState },
  );

  readonly cards = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? buildCards(s.current, s.previous) : null;
  });
  readonly breakdown = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.current.properties : [];
  });

  // --- custom range -------------------------------------------------------

  private readonly fb = inject(FormBuilder);
  readonly custom = this.fb.group({ start: this.fb.control<Date | null>(null), end: this.fb.control<Date | null>(null) });

  constructor() {
    // Keep the custom picker showing the current period.
    this.period$.pipe(takeUntilDestroyed()).subscribe((p) =>
      this.custom.setValue({ start: p.from, end: p.to }, { emitEvent: false }),
    );
  }

  /** Latest allowed end for the custom picker: start + 365 days (366 nights incl.). */
  customMax(): Date | null {
    const start = this.custom.controls.start.value;
    return start && !this.custom.controls.end.value ? addDays(start, MAX_PERIOD_DAYS - 1) : null;
  }

  /** "Custom" was clicked but no custom range applied yet. */
  readonly customOpen = signal(false);
  readonly showCustom = computed(() => this.customOpen() || this.period().preset === 'custom');
  readonly toggleValue = computed(() => (this.customOpen() ? 'custom' : this.period().preset));

  selectPreset(preset: PeriodPreset): void {
    this.customOpen.set(preset === 'custom');
    if (preset === 'custom') return; // the date-range picker applies custom ranges
    const range = parsePeriod({ get: (k) => (k === 'period' ? preset : null) });
    this.go(range);
  }

  applyCustom(): void {
    const { start, end } = this.custom.getRawValue();
    if (!start || !end || end < start || periodLength(start, end) > MAX_PERIOD_DAYS) return;
    this.customOpen.set(false);
    this.go({ preset: 'custom', from: start, to: end });
  }

  retry(): void {
    this.retry$.next();
  }

  deltaLabel(d: Delta): string {
    const tone = d.good === null ? '' : d.good ? ' (better)' : ' (worse)';
    return `${d.text} ${this.comparison().label}${tone}`;
  }

  private go(p: Period): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: periodQueryParams(p) });
  }
}
