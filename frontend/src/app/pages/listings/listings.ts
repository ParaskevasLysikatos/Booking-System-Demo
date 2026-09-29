import { BreakpointObserver } from '@angular/cdk/layout';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router } from '@angular/router';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  merge,
  of,
  scan,
  startWith,
  switchMap,
} from 'rxjs';

import { parseApiErrors } from '../../core/api-errors';
import { addDays, nightsBetween, todayLocal, toIsoDate } from '../../core/dates';
import { formatPrice } from '../../core/money';
import {
  MapPin,
  MapPins,
  Paginated,
  PropertyFilters,
  PropertyOrdering,
  PropertySummary,
} from '../../core/properties/property.models';
import { PropertyService } from '../../core/properties/property.service';
import { MapComponent } from '../../shared/map/map';
import { MapMarker } from '../../shared/map/map-markers';
import { ListingQuery, PAGE_SIZES, listKey, parseListingQuery, pinsKey, toQueryParams } from './listing-query';
import { MapPopupCardComponent } from './map-popup-card/map-popup-card';
import { PropertyCardComponent } from './property-card/property-card';
import { provideLocalizedDatepicker } from '../../core/i18n/datepicker-i18n';

type ListState =
  | { status: 'loading'; query: ListingQuery }
  | { status: 'ok'; query: ListingQuery; data: Paginated<PropertySummary> }
  | { status: 'error'; query: ListingQuery; message: string; badRequest: boolean };

/**
 * The map's pins (TICKET-034). `data` is the last pins that loaded - kept
 * while a new search loads, so the map doesn't flash empty.
 */
type PinsState =
  | { status: 'off' }
  | { status: 'loading'; data?: MapPins }
  | { status: 'ok'; data: MapPins }
  | { status: 'error'; data?: MapPins };

/** List and map side by side from this width (TICKET-034). Same as $wide in styles/_responsive.scss. */
export const SPLIT_VIEW_QUERY = '(min-width: 1100px)';

/** API field names -> words, for messages like "check_in can't be in the past." */
function humanize(message: string): string {
  return message
    .replace(/\bcheck_in\b/g, 'Check-in')
    .replace(/\bcheck_out\b/g, 'Check-out')
    .replace(/\bmin_price\b/g, 'Min price')
    .replace(/\bmax_price\b/g, 'Max price');
}

/** Both dates or neither, and check-out after check-in. */
const dateRangeValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const { start, end } = group.value as { start: Date | null; end: Date | null };
  if (!start && !end) return null;
  if (!start || !end) return { incomplete: true };
  return nightsBetween(start, end) < 1 ? { noNights: true } : null;
};

const priceRangeValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const { minPrice, maxPrice } = group.value as { minPrice: number | null; maxPrice: number | null };
  return minPrice != null && maxPrice != null && minPrice > maxPrice ? { priceRange: true } : null;
};

@Component({
  selector: 'app-listings',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    MapComponent,
    MapPopupCardComponent,
    PropertyCardComponent,
  ],
  // Native Date adapter + dd/mm/yyyy display (how dates are written in Greece).
  providers: [provideLocalizedDatepicker()], // date pickers in the chosen language (TICKET-038)
  templateUrl: './listings.html',
  styleUrl: './listings.scss',
})
export class PropertyListPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly properties = inject(PropertyService);

  readonly minDate = todayLocal();
  readonly maxDate = addDays(this.minDate, 365);
  readonly guestOptions = Array.from({ length: 16 }, (_, i) => i + 1);
  readonly pageSizes = PAGE_SIZES;
  readonly sortOptions: { value: PropertyOrdering; label: string }[] = [
    { value: 'newest', label: 'Newest' },
    { value: 'price', label: 'Price: low to high' },
    { value: '-price', label: 'Price: high to low' },
    { value: '-capacity', label: 'Most guests' },
    { value: 'capacity', label: 'Fewest guests' },
  ];

  private readonly fb = inject(FormBuilder);
  readonly form = this.fb.group(
    {
      dates: this.fb.group(
        { start: this.fb.control<Date | null>(null), end: this.fb.control<Date | null>(null) },
        { validators: dateRangeValidator },
      ),
      location: this.fb.nonNullable.control('', Validators.maxLength(255)),
      guests: this.fb.control<number | null>(null),
      minPrice: this.fb.control<number | null>(null, Validators.min(0)),
      maxPrice: this.fb.control<number | null>(null, Validators.min(0)),
      ordering: this.fb.nonNullable.control<PropertyOrdering>('newest'),
    },
    { validators: priceRangeValidator },
  );

  /** Bumped by "Try again" to re-run the current query. */
  private readonly retry$ = new BehaviorSubject<void>(undefined);
  private readonly query$ = this.route.queryParamMap.pipe(map(parseListingQuery));
  /** The list only reloads when the search or page changes - not on List/Map. */
  private readonly listQuery$ = this.query$.pipe(distinctUntilChanged((a, b) => listKey(a) === listKey(b)));

  /** The URL is the source of truth: every URL change -> one API call (older ones cancelled). */
  readonly state = toSignal(
    combineLatest([this.listQuery$, this.retry$]).pipe(
      switchMap(([query]) =>
        this.properties.list(query.filters, query.page).pipe(
          map((data): ListState => ({ status: 'ok', query, data })),
          catchError((err) => {
            const parsed = parseApiErrors(err);
            const message = humanize(parsed.general ?? Object.values(parsed.fields).flat().join(' '));
            // A 400 means the search itself is invalid (e.g. a hand-edited URL
            // with past dates) - offer "Clear filters", not a pointless retry.
            const badRequest = err instanceof HttpErrorResponse && err.status === 400;
            return of<ListState>({ status: 'error', query, message: message || 'Could not load stays.', badRequest });
          }),
          startWith<ListState>({ status: 'loading', query }),
        ),
      ),
    ),
    { requireSync: true },
  );

  // --- map (TICKET-034) ---------------------------------------------------

  /** Wide screens: list and map side by side, no List/Map button. */
  readonly splitView = toSignal(
    inject(BreakpointObserver).observe(SPLIT_VIEW_QUERY).pipe(map((r) => r.matches)),
    { initialValue: false },
  );
  private readonly view = toSignal(this.query$.pipe(map((q) => q.view)), { initialValue: undefined });
  /** Phones/tablets: the map instead of the list (`?view=map`). */
  readonly mapOnly = computed(() => !this.splitView() && this.view() === 'map');
  readonly showMap = computed(() => this.splitView() || this.mapOnly());
  readonly showList = computed(() => !this.mapOnly());

  /** The card under the mouse / keyboard focus - its pin is lifted. */
  readonly hoveredId = signal<number | null>(null);

  private readonly pinsRetry$ = new BehaviorSubject<void>(undefined);
  /** Pins load only while the map is shown, and only when the filters change (not the page). */
  readonly pins = toSignal(
    combineLatest([
      this.query$.pipe(distinctUntilChanged((a, b) => pinsKey(a) === pinsKey(b))),
      toObservable(this.showMap),
      this.pinsRetry$,
    ]).pipe(
      switchMap(([query, show]) =>
        !show
          ? of<PinsState>({ status: 'off' })
          : this.properties.mapPins(query.filters).pipe(
              map((data): PinsState => ({ status: 'ok', data })),
              catchError(() => of<PinsState>({ status: 'error' })),
              startWith<PinsState>({ status: 'loading' }),
            ),
      ),
      // Keep the previous pins on the map while the next ones load (or fail).
      scan((prev: PinsState, next: PinsState): PinsState => {
        const last = prev.status === 'off' ? undefined : prev.data;
        return next.status === 'loading' || next.status === 'error' ? { ...next, data: last } : next;
      }, { status: 'off' } as PinsState),
    ),
    { initialValue: { status: 'off' } as PinsState },
  );

  readonly markers = computed<MapMarker<MapPin>[]>(() => {
    const pins = this.pins();
    const results = pins.status === 'off' ? [] : (pins.data?.results ?? []);
    return results.map((p) => {
      const price = formatPrice(p.price_per_night);
      return {
        id: p.id,
        lat: p.latitude,
        lng: p.longitude,
        label: price,
        title: `${p.title}, ${price} a night`,
        data: p,
      };
    });
  });

  /** "2 stays aren't on the map" - matching stays with no position. */
  readonly missingOnMap = computed(() => {
    const pins = this.pins();
    return pins.status === 'ok' ? pins.data.missing_position : 0;
  });
  readonly pinsTruncated = computed(() => {
    const pins = this.pins();
    return pins.status === 'ok' && pins.data.truncated;
  });

  constructor() {
    // URL -> form (initial load, Back/Forward, shared links). emitEvent:false
    // so this never loops back into a navigation.
    this.query$.pipe(takeUntilDestroyed()).subscribe(({ filters }) => {
      this.form.setValue(
        {
          dates: { start: filters.checkIn ?? null, end: filters.checkOut ?? null },
          location: filters.location ?? '',
          guests: filters.guests ?? null,
          minPrice: filters.minPrice ?? null,
          maxPrice: filters.maxPrice ?? null,
          ordering: filters.ordering ?? 'newest',
        },
        { emitEvent: false },
      );
    });

    // Sort applies instantly, price after a short pause; both refine the
    // *current* search (dates/location/guests still need "Search").
    const c = this.form.controls;
    merge(c.ordering.valueChanges, merge(c.minPrice.valueChanges, c.maxPrice.valueChanges).pipe(debounceTime(500)))
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.applyRefinements());
  }

  // --- derived view state -------------------------------------------------

  get query(): ListingQuery {
    return this.state().query;
  }

  nights(): number | null {
    const { checkIn, checkOut } = this.query.filters;
    return checkIn && checkOut ? nightsBetween(checkIn, checkOut) : null;
  }

  /** Dates/guests carried to the detail page so it can pre-fill the booking. */
  cardLinkParams(): Record<string, string | number> {
    const { checkIn, checkOut, guests } = this.query.filters;
    const params: Record<string, string | number> = {};
    if (checkIn && checkOut) {
      params['check_in'] = toIsoDate(checkIn);
      params['check_out'] = toIsoDate(checkOut);
    }
    if (guests) params['guests'] = guests;
    return params;
  }

  hasFilters(): boolean {
    const f = this.query.filters;
    return !!(f.location || f.guests || f.checkIn || f.minPrice !== undefined || f.maxPrice !== undefined);
  }

  dateError(): string | null {
    const dates = this.form.controls.dates;
    if (!dates.touched && !dates.dirty) return null;
    if (dates.hasError('incomplete')) return 'Pick both a check-in and a check-out date.';
    if (dates.hasError('noNights')) return 'Check-out must be after check-in.';
    return null;
  }

  // --- actions ------------------------------------------------------------

  search(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.navigate(this.formFilters(), 1);
  }

  clearFilters(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toQueryParams({ filters: {}, page: { ...this.query.page, page: 1 }, view: this.view() }),
    });
  }

  retry(): void {
    this.retry$.next();
  }

  retryPins(): void {
    this.pinsRetry$.next();
  }

  /** Phones/tablets: switch between the list and the map (kept in the URL). */
  toggleView(): void {
    const toMap = this.view() !== 'map';
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: toQueryParams({ ...this.query, view: toMap ? 'map' : undefined }),
      })
      .then(() => window.scrollTo({ top: 0 }));
  }

  onPage(event: PageEvent): void {
    const sizeChanged = event.pageSize !== this.query.page.pageSize;
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: toQueryParams({
          filters: this.query.filters,
          page: { page: sizeChanged ? 1 : event.pageIndex + 1, pageSize: event.pageSize },
          view: this.view(),
        }),
      })
      .then(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  private applyRefinements(): void {
    const c = this.form.controls;
    if (c.minPrice.invalid || c.maxPrice.invalid || this.form.hasError('priceRange')) return;
    const current = this.query.filters;
    const next: PropertyFilters = {
      ...current,
      ordering: c.ordering.value,
      minPrice: c.minPrice.value ?? undefined,
      maxPrice: c.maxPrice.value ?? undefined,
    };
    if (
      next.ordering === (current.ordering ?? 'newest') &&
      next.minPrice === current.minPrice &&
      next.maxPrice === current.maxPrice
    ) {
      return; // nothing actually changed
    }
    this.navigate(next, 1);
  }

  private formFilters(): PropertyFilters {
    const v = this.form.getRawValue();
    return {
      location: v.location.trim() || undefined,
      guests: v.guests ?? undefined,
      checkIn: v.dates.start ?? undefined,
      checkOut: v.dates.end ?? undefined,
      minPrice: v.minPrice ?? undefined,
      maxPrice: v.maxPrice ?? undefined,
      ordering: v.ordering,
    };
  }

  private navigate(filters: PropertyFilters, page: number): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toQueryParams({ filters, page: { page, pageSize: this.query.page.pageSize }, view: this.view() }),
    });
  }
}
