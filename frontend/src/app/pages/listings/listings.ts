import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, debounceTime, map, merge, of, startWith, switchMap } from 'rxjs';

import { parseApiErrors } from '../../core/api-errors';
import { addDays, nightsBetween, todayLocal, toIsoDate } from '../../core/dates';
import { Paginated, PropertyFilters, PropertyOrdering, PropertySummary } from '../../core/properties/property.models';
import { PropertyService } from '../../core/properties/property.service';
import { ListingQuery, PAGE_SIZES, parseListingQuery, toQueryParams } from './listing-query';
import { PropertyCardComponent } from './property-card/property-card';

type ListState =
  | { status: 'loading'; query: ListingQuery }
  | { status: 'ok'; query: ListingQuery; data: Paginated<PropertySummary> }
  | { status: 'error'; query: ListingQuery; message: string; badRequest: boolean };

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
    MatSelectModule,
    PropertyCardComponent,
  ],
  // Native Date adapter + dd/mm/yyyy display (how dates are written in Greece).
  providers: [provideNativeDateAdapter(), { provide: MAT_DATE_LOCALE, useValue: 'en-GB' }],
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

  /** The URL is the source of truth: every URL change -> one API call (older ones cancelled). */
  readonly state = toSignal(
    combineLatest([this.query$, this.retry$]).pipe(
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
      queryParams: toQueryParams({ filters: {}, page: { ...this.query.page, page: 1 } }),
    });
  }

  retry(): void {
    this.retry$.next();
  }

  onPage(event: PageEvent): void {
    const sizeChanged = event.pageSize !== this.query.page.pageSize;
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: toQueryParams({
          filters: this.query.filters,
          page: { page: sizeChanged ? 1 : event.pageIndex + 1, pageSize: event.pageSize },
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
      queryParams: toQueryParams({ filters, page: { page, pageSize: this.query.page.pageSize } }),
    });
  }
}
