import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatStepper, MatStepperModule } from '@angular/material/stepper';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';

import { parseApiErrors } from '../../core/api-errors';
import { cancelDeadline, formatDeadline, GUEST_CANCELLATION_HOURS } from '../../core/bookings/booking-policy';
import { Booking } from '../../core/bookings/booking.models';
import { BookingService } from '../../core/bookings/booking.service';
import { addDays, nightsBetween, parseIsoDate, todayLocal, toIsoDate } from '../../core/dates';
import { formatPrice } from '../../core/money';
import { BookedNights } from '../../core/properties/availability';
import { MAX_DAYS_AHEAD, PropertyDetail } from '../../core/properties/property.models';
import { PropertyService } from '../../core/properties/property.service';
import { stayDateFilter, stayProblem } from '../../core/properties/stay-rules';
import { BrowserRedirect } from '../../core/payments/browser-redirect';
import { clockTime } from '../../core/payments/countdown';
import { PaymentService } from '../../core/payments/payment.service';
import { BookingSummary } from '../../shared/booking-summary';

type LoadStatus = 'loading' | 'ok' | 'unavailable' | 'error';
export type AvailabilityStatus = 'idle' | 'checking' | 'available' | 'unavailable' | 'error';

/** API field names -> words for error messages. */
function humanize(message: string): string {
  return message.replace(/\bcheck_in\b/g, 'Check-in').replace(/\bcheck_out\b/g, 'Check-out');
}

/**
 * /booking/:propertyId (TICKET-020) - two steps (agreed):
 *   1. Your trip: dates + guests, live price and availability.
 *   2. Review & confirm: summary, cancellation policy, Confirm booking.
 * Then a confirmation screen built from the server's response.
 * Guarded by authGuard (login first, then back here with the stay kept).
 *
 * With online payments on (TICKET-029) step 2 says "Confirm and pay": the
 * booking is created (holding the dates), then the browser goes to Stripe's
 * payment page. If opening that page fails, "Try again" reuses the booking
 * that already exists - it never creates a second one.
 */
@Component({
  selector: 'app-booking',
  imports: [
    BookingSummary,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatStepperModule,
  ],
  providers: [provideNativeDateAdapter(), { provide: MAT_DATE_LOCALE, useValue: 'en-GB' }],
  templateUrl: './booking.html',
  styleUrl: './booking.scss',
})
export class BookingFormPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly properties = inject(PropertyService);
  private readonly bookings = inject(BookingService);
  private readonly titleService = inject(Title);
  private readonly payments = inject(PaymentService);
  private readonly redirect = inject(BrowserRedirect);

  readonly stepper = viewChild(MatStepper);

  readonly minDate = todayLocal();
  readonly maxDate = addDays(this.minDate, MAX_DAYS_AHEAD);
  readonly cancellationHours = GUEST_CANCELLATION_HOURS;
  readonly propertyId = Number(this.route.snapshot.paramMap.get('propertyId'));

  private readonly fb = inject(FormBuilder);
  readonly form = this.fb.group({
    dates: this.fb.group({ start: this.fb.control<Date | null>(null), end: this.fb.control<Date | null>(null) }),
    guests: this.fb.nonNullable.control(1),
  });
  private readonly formValue = toSignal(this.form.valueChanges.pipe(startWith(this.form.value)), {
    initialValue: this.form.value,
  });

  // --- the property -------------------------------------------------------

  readonly loadStatus = signal<LoadStatus>('loading');
  readonly property = signal<PropertyDetail | null>(null);
  readonly booked = computed(() => new BookedNights(this.property()?.availability.booked_ranges ?? []));
  readonly guestOptions = computed(() => Array.from({ length: this.property()?.capacity ?? 1 }, (_, i) => i + 1));
  readonly cover = computed(() => {
    const p = this.property();
    return p?.images.find((i) => i.is_cover)?.image ?? p?.images[0]?.image ?? p?.cover_image ?? null;
  });

  // --- the stay -----------------------------------------------------------

  readonly checkIn = computed(() => this.formValue().dates?.start ?? null);
  readonly checkOut = computed(() => this.formValue().dates?.end ?? null);
  readonly guests = computed(() => this.formValue().guests ?? 1);
  readonly nights = computed(() => {
    const a = this.checkIn();
    const b = this.checkOut();
    return a && b ? nightsBetween(a, b) : 0;
  });
  readonly dateProblem = computed(() => stayProblem(this.checkIn(), this.checkOut(), this.booked(), this.minDate));
  readonly pickerFilter = computed(() => stayDateFilter(this.booked(), this.checkIn(), this.checkOut()));

  readonly availability = signal<AvailabilityStatus>('idle');
  private readonly availabilityQuery = computed(() => {
    const p = this.property();
    const a = this.checkIn();
    const b = this.checkOut();
    return p && a && b && !this.dateProblem() ? { id: p.id, a: toIsoDate(a), b: toIsoDate(b) } : null;
  });

  readonly nightly = computed(() => formatPrice(this.property()?.price_per_night ?? 0));
  readonly total = computed(() => {
    const p = this.property();
    return p && this.nights() ? formatPrice(Number(p.price_per_night) * this.nights()) : null;
  });

  /** Policy preview - the server returns the authoritative deadline once booked. */
  readonly deadline = computed(() => {
    const a = this.checkIn();
    if (!a) return null;
    const d = cancelDeadline(a);
    return { text: formatDeadline(d), passed: d.getTime() <= Date.now() };
  });

  /** Step 1 is complete only when the server has confirmed the dates are free. */
  readonly tripReady = computed(
    () => !!this.property()?.is_active && !this.dateProblem() && !!this.checkIn() && this.availability() === 'available',
  );

  // --- online payment (TICKET-029) -----------------------------------------

  /** Only for wording before booking; what happens after is decided by the booking's own `payment`. */
  readonly paymentsConfig = toSignal(this.payments.config(), { initialValue: null });
  readonly paymentsOn = computed(() => this.paymentsConfig()?.enabled === true);
  readonly holdMinutes = computed(() => this.paymentsConfig()?.hold_minutes ?? 30);

  // --- submitting ---------------------------------------------------------

  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly booking = signal<Booking | null>(null);

  /** Created, holding its dates, but not paid yet (we're sending the guest to Stripe). */
  readonly awaitingPayment = computed(() => this.booking()?.payment?.status === 'open');
  readonly redirecting = signal(false);
  readonly checkoutError = signal<string | null>(null);

  constructor() {
    this.titleService.setTitle('Book your stay · Booking System Demo');
    if (!Number.isInteger(this.propertyId) || this.propertyId <= 0) {
      void this.router.navigateByUrl('/listings');
      return;
    }

    // Pre-fill from the URL (Book now / login returnUrl / reload).
    const q = this.route.snapshot.queryParamMap;
    const start = parseIsoDate(q.get('check_in'));
    const end = parseIsoDate(q.get('check_out'));
    const guests = Number(q.get('guests'));
    this.form.setValue({
      dates: { start, end: start && end ? end : null },
      guests: Number.isInteger(guests) && guests > 0 ? guests : 1,
    });

    this.loadProperty();

    effect(() => {
      const p = this.property();
      if (p && this.form.controls.guests.value > p.capacity) this.form.controls.guests.setValue(p.capacity);
    });

    // Keep the URL in sync (reload/share keeps the stay; replaceUrl = no history spam).
    this.form.valueChanges.pipe(debounceTime(150), takeUntilDestroyed()).subscribe(() => {
      if (this.booking()) return;
      const a = this.checkIn();
      const b = this.checkOut();
      void this.router.navigate([], {
        relativeTo: this.route,
        replaceUrl: true,
        queryParams: {
          check_in: a && b ? toIsoDate(a) : null,
          check_out: a && b ? toIsoDate(b) : null,
          guests: this.guests(),
        },
      });
    });

    // Live availability check (one computed signal -> glitch-free).
    toObservable(this.availabilityQuery)
      .pipe(
        distinctUntilChanged((x, y) => JSON.stringify(x) === JSON.stringify(y)),
        switchMap((req) =>
          !req
            ? of<AvailabilityStatus>('idle')
            : this.properties
                .get(req.id, { checkIn: parseIsoDate(req.a)!, checkOut: parseIsoDate(req.b)! })
                .pipe(
                  map((d): AvailabilityStatus => (d.availability.is_available ? 'available' : 'unavailable')),
                  catchError(() => of<AvailabilityStatus>('error')),
                  startWith<AvailabilityStatus>('checking'),
                ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((s) => this.availability.set(s));
  }

  /** (Re)load the property. A refresh keeps the page on screen (no loading flash). */
  loadProperty(): void {
    if (!this.property()) this.loadStatus.set('loading');
    this.properties.get(this.propertyId).subscribe({
      next: (p) => {
        this.property.set(p);
        this.loadStatus.set(p.is_active ? 'ok' : 'unavailable');
        this.titleService.setTitle(`Book ${p.title} · Booking System Demo`);
      },
      error: (err) => {
        if (this.property()) return; // keep what we have on a failed refresh
        this.loadStatus.set(err instanceof HttpErrorResponse && err.status === 404 ? 'unavailable' : 'error');
      },
    });
  }

  confirm(): void {
    // Already booked and waiting for payment: only (re)open the payment page -
    // never a second booking.
    const existing = this.booking();
    if (existing) {
      if (this.awaitingPayment()) this.goToPayment(existing);
      return;
    }
    const p = this.property();
    const a = this.checkIn();
    const b = this.checkOut();
    // In-flight guard: a double click can never send two bookings.
    if (!p || !a || !b || this.submitting() || !this.tripReady()) return;

    this.submitting.set(true);
    this.submitError.set(null);
    this.bookings
      .create({ property: p.id, check_in: toIsoDate(a), check_out: toIsoDate(b), guests: this.guests() })
      .subscribe({
        next: (booking) => {
          this.submitting.set(false);
          this.booking.set(booking);
          window.scrollTo?.({ top: 0, behavior: 'smooth' });
          if (booking.payment?.status === 'open') {
            this.titleService.setTitle('Secure payment · Booking System Demo');
            this.goToPayment(booking);
          } else {
            this.titleService.setTitle('Booking request sent · Booking System Demo');
          }
        },
        error: (err) => {
          this.submitting.set(false);
          const parsed = parseApiErrors(err);
          const message = humanize(parsed.general ?? Object.values(parsed.fields).flat().join(' '));
          if (err instanceof HttpErrorResponse && err.status === 409) {
            // Someone booked (some of) these nights meanwhile: show it, refresh the
            // booked nights so they appear struck through, and go back to step 1.
            this.submitError.set(message || 'These dates were just booked by someone else. Please pick different dates.');
            this.availability.set('unavailable');
            this.loadProperty();
          } else {
            this.submitError.set(message || 'Something went wrong. Please try again.');
          }
          this.stepper()?.previous();
        },
      });
  }

  /**
   * Ask the server for the booking's Stripe payment page and leave for it.
   * Safe to repeat (the server hands back the same page), and guarded so a
   * double click sends one request.
   */
  goToPayment(booking: Booking): void {
    if (this.redirecting()) return;
    this.redirecting.set(true);
    this.checkoutError.set(null);
    this.payments.checkout(booking.id).subscribe({
      next: (res) => this.redirect.to(res.checkout_url), // stays "redirecting" while the browser leaves
      error: (err) => {
        this.redirecting.set(false);
        this.checkoutError.set(parseApiErrors(err).general ?? "We couldn't open the payment page. Please try again.");
      },
    });
  }

  clockTime = clockTime;

  /** "Back to the stay" keeps the chosen dates/guests. */
  readonly backParams = computed(() => {
    const a = this.checkIn();
    const b = this.checkOut();
    return a && b ? { check_in: toIsoDate(a), check_out: toIsoDate(b), guests: this.guests() } : { guests: this.guests() };
  });

  formatPrice = formatPrice;
  dateText(iso: string | Date): string {
    const d = typeof iso === 'string' ? parseIsoDate(iso)! : iso;
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
}
