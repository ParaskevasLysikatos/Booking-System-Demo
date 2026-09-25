import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';

import { amenityIcon, amenityLabel } from '../../core/amenities';
import { AuthService } from '../../core/auth/auth.service';
import { addDays, nightsBetween, parseIsoDate, todayLocal, toIsoDate } from '../../core/dates';
import { formatPrice } from '../../core/money';
import { BookedNights } from '../../core/properties/availability';
import { MAX_DAYS_AHEAD, MAX_NIGHTS, PropertyDetail } from '../../core/properties/property.models';
import { PropertyService } from '../../core/properties/property.service';
import { AvailabilityCalendarComponent, DateSelection } from './availability-calendar/availability-calendar';
import { GalleryComponent } from './gallery/gallery';

type DetailState =
  | { status: 'loading' }
  | { status: 'ok'; property: PropertyDetail }
  | { status: 'notFound' }
  | { status: 'error' };

export type AvailabilityStatus = 'idle' | 'checking' | 'available' | 'unavailable' | 'error';

@Component({
  selector: 'app-property-detail',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    AvailabilityCalendarComponent,
    GalleryComponent,
  ],
  providers: [provideNativeDateAdapter(), { provide: MAT_DATE_LOCALE, useValue: 'en-GB' }],
  templateUrl: './property-detail.html',
  styleUrl: './property-detail.scss',
})
export class PropertyDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly properties = inject(PropertyService);
  private readonly auth = inject(AuthService);
  private readonly titleService = inject(Title);

  readonly minDate = todayLocal();
  readonly maxDate = addDays(this.minDate, MAX_DAYS_AHEAD);
  readonly amenityLabel = amenityLabel;
  readonly amenityIcon = amenityIcon;

  /** "Back to results" returns to the exact listings search we came from, if any. */
  readonly backUrl = (() => {
    const prev = this.router.getCurrentNavigation()?.previousNavigation?.finalUrl;
    const url = prev ? this.router.serializeUrl(prev) : '';
    return /^\/listings(\?|$)/.test(url) ? url : '/listings';
  })();

  private readonly fb = inject(FormBuilder);
  readonly form = this.fb.group({
    dates: this.fb.group({ start: this.fb.control<Date | null>(null), end: this.fb.control<Date | null>(null) }),
    guests: this.fb.nonNullable.control(1),
  });
  private readonly formValue = toSignal(this.form.valueChanges.pipe(startWith(this.form.value)), {
    initialValue: this.form.value,
  });

  // --- the property -------------------------------------------------------

  private readonly retry$ = new BehaviorSubject<void>(undefined);
  readonly id = toSignal(this.route.paramMap.pipe(map((p) => Number(p.get('id')))), { requireSync: true });

  readonly state = toSignal(
    combineLatest([toObservable(this.id).pipe(distinctUntilChanged()), this.retry$]).pipe(
      switchMap(([id]) =>
        this.load(id).pipe(
          map((property): DetailState => (property ? { status: 'ok', property } : { status: 'notFound' })),
          catchError((err) =>
            of<DetailState>(err instanceof HttpErrorResponse && err.status === 404 ? { status: 'notFound' } : { status: 'error' }),
          ),
          startWith<DetailState>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as DetailState },
  );

  readonly property = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.property : null;
  });
  readonly booked = computed(() => new BookedNights(this.property()?.availability.booked_ranges ?? []));
  readonly guestOptions = computed(() => Array.from({ length: this.property()?.capacity ?? 1 }, (_, i) => i + 1));

  // --- the chosen stay ----------------------------------------------------

  readonly checkIn = computed(() => this.formValue().dates?.start ?? null);
  readonly checkOut = computed(() => this.formValue().dates?.end ?? null);
  readonly guests = computed(() => this.formValue().guests ?? 1);
  readonly nights = computed(() => {
    const a = this.checkIn();
    const b = this.checkOut();
    return a && b ? nightsBetween(a, b) : 0;
  });

  /** Instant client-side verdict (null = fine so far). */
  readonly dateProblem = computed((): string | null => {
    const a = this.checkIn();
    const b = this.checkOut();
    if (!a && !b) return null;
    if (a && !b) return 'Pick a check-out date.';
    if (!a || !b) return 'Pick a check-in date.';
    if (this.nights() < 1) return 'Check-out must be after check-in.';
    if (a < this.minDate) return "Check-in can't be in the past.";
    if (a > this.maxDate) return `Bookings open at most ${MAX_DAYS_AHEAD} days ahead.`;
    if (this.nights() > MAX_NIGHTS) return `A stay can be at most ${MAX_NIGHTS} nights.`;
    if (!this.booked().isFree(a, b)) return 'Some of these nights are already booked.';
    return null;
  });

  /** Server-confirmed availability for complete, locally-valid dates. */
  readonly availability = signal<AvailabilityStatus>('idle');

  readonly nightly = computed(() => formatPrice(this.property()?.price_per_night ?? 0));
  readonly total = computed(() =>
    this.property() && this.nights() ? formatPrice(Number(this.property()!.price_per_night) * this.nights()) : null,
  );

  readonly bookingParams = computed(() => {
    const a = this.checkIn();
    const b = this.checkOut();
    return a && b ? { check_in: toIsoDate(a), check_out: toIsoDate(b), guests: this.guests() } : null;
  });

  /** What to ask the API: only complete stays that already pass the local checks. */
  private readonly availabilityQuery = computed(() => {
    const p = this.property();
    const params = this.bookingParams();
    return p && params && !this.dateProblem() ? { id: p.id, checkIn: params.check_in, checkOut: params.check_out } : null;
  });

  readonly canBook = computed(
    () =>
      !!this.property()?.is_active &&
      !!this.bookingParams() &&
      !this.dateProblem() &&
      this.availability() === 'available',
  );

  constructor() {
    this.titleService.setTitle('Stay · Booking System Demo');

    // Pre-fill from the URL once (card link / reload / shared link).
    const q = this.route.snapshot.queryParamMap;
    const start = parseIsoDate(q.get('check_in'));
    const end = parseIsoDate(q.get('check_out'));
    const guests = Number(q.get('guests'));
    this.form.setValue({
      dates: { start, end: start && end ? end : null },
      guests: Number.isInteger(guests) && guests > 0 ? guests : 1,
    });

    // Title tab + clamp guests to capacity once the property is known.
    effect(() => {
      const p = this.property();
      if (!p) return;
      this.titleService.setTitle(`${p.title} · Booking System Demo`);
      if (this.form.controls.guests.value > p.capacity) this.form.controls.guests.setValue(p.capacity);
    });

    // Keep the URL in sync (replaceUrl: no history spam), so reload/share keeps the stay.
    this.form.valueChanges.pipe(debounceTime(150), takeUntilDestroyed()).subscribe(() => {
      const a = this.checkIn();
      const b = this.checkOut();
      void this.router.navigate([], {
        relativeTo: this.route,
        replaceUrl: true,
        queryParams: {
          check_in: a && b ? toIsoDate(a) : null,
          check_out: a && b ? toIsoDate(b) : null,
          guests: this.guests() > 1 ? this.guests() : null,
        },
      });
    });

    // Ask the API once dates are complete and pass the local checks. One
    // computed signal (not combineLatest of several) so it's glitch-free:
    // never a request with a half-updated combination of values.
    toObservable(this.availabilityQuery)
      .pipe(
        distinctUntilChanged((x, y) => JSON.stringify(x) === JSON.stringify(y)),
        switchMap((req) => {
          if (!req) return of<AvailabilityStatus>('idle');
          return this.properties
            .get(req.id, { checkIn: parseIsoDate(req.checkIn)!, checkOut: parseIsoDate(req.checkOut)! })
            .pipe(
              map((d): AvailabilityStatus => (d.availability.is_available ? 'available' : 'unavailable')),
              catchError(() => of<AvailabilityStatus>('error')),
              startWith<AvailabilityStatus>('checking'),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((status) => this.availability.set(status));
  }

  // --- actions ------------------------------------------------------------

  onCalendar(sel: DateSelection): void {
    this.form.controls.dates.setValue({ start: sel.start, end: sel.end });
  }

  /** Booked nights can't be chosen in the panel's picker either. */
  readonly pickerFilter = computed(() => {
    const booked = this.booked();
    const start = this.checkIn();
    const end = this.checkOut();
    return (d: Date | null): boolean => {
      if (!d) return false;
      if (start && !end && d > start) return nightsBetween(start, d) <= MAX_NIGHTS && booked.isFree(start, d);
      return !booked.isBooked(d);
    };
  });

  bookNow(): void {
    const p = this.property();
    const params = this.bookingParams();
    if (!p || !params || !this.canBook()) return;
    const target = this.router.createUrlTree(['/booking', p.id], { queryParams: params });
    if (this.auth.isLoggedIn()) {
      void this.router.navigateByUrl(target);
    } else {
      // Log in (or sign up) first, then land on the booking form with everything kept.
      void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.serializeUrl(target) } });
    }
  }

  retry(): void {
    this.retry$.next();
  }

  private load(id: number): Observable<PropertyDetail | null> {
    return Number.isInteger(id) && id > 0 ? this.properties.get(id) : of(null);
  }
}
