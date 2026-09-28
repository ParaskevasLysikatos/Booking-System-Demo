import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
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
import { MAX_DAYS_AHEAD, PropertyDetail } from '../../core/properties/property.models';
import { stayDateFilter, stayProblem } from '../../core/properties/stay-rules';
import { PropertyService } from '../../core/properties/property.service';
import { RatingSummary, Review, ViewerReview } from '../../core/reviews/review.models';
import { ReviewDialog, ReviewDialogData } from '../../shared/review-dialog';
import { StarRatingComponent } from '../../shared/star-rating';
import { AvailabilityCalendarComponent, DateSelection } from './availability-calendar/availability-calendar';
import { GalleryComponent } from './gallery/gallery';
import { PropertyReviewsComponent } from './reviews/property-reviews';

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
    PropertyReviewsComponent,
    StarRatingComponent,
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
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

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
  readonly dateProblem = computed(() => stayProblem(this.checkIn(), this.checkOut(), this.booked(), this.minDate));

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

  // --- the phone/tablet bottom bar (TICKET-031) ----------------------------

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  /** True while the booking panel is on screen; the bottom bar then hides. */
  readonly panelInView = signal(false);

  private readonly watchPanel = effect((onCleanup) => {
    const el = this.panel()?.nativeElement;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => this.panelInView.set(entry.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    onCleanup(() => io.disconnect());
  });

  /** Bottom bar "Choose dates": bring the booking panel into view. */
  goToPanel(): void {
    const el = this.panel()?.nativeElement;
    if (!el) return;
    el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  }

  // --- reviews (TICKET-032) ------------------------------------------------

  private readonly reviewsSection = viewChild<ElementRef<HTMLElement>>('reviews');
  private readonly reviewsList = viewChild(PropertyReviewsComponent);

  /** Latest summary from the Reviews section (per property), so the header follows a new review. */
  readonly reviewSummary = signal<{ id: number; summary: RatingSummary } | null>(null);
  /** Set once the caller posts a review here, so the button turns into "You rated this stay". */
  private readonly postedReview = signal<{ id: number; viewer: ViewerReview } | null>(null);

  readonly headerRating = computed(() => {
    const p = this.property();
    const s = this.reviewSummary();
    if (p && s && s.id === p.id) return { avg: s.summary.rating_avg, count: s.summary.review_count };
    return { avg: p?.rating_avg ?? null, count: p?.review_count ?? 0 };
  });

  private readonly viewer = computed<ViewerReview | null>(() => {
    const p = this.property();
    if (!p) return null;
    const posted = this.postedReview();
    return posted && posted.id === p.id ? posted.viewer : (p.viewer_review ?? null);
  });
  /** The server decides (confirmed stay that has ended, not reviewed yet) - never worked out here. */
  readonly canReview = computed(() => !!this.viewer()?.can_review);
  readonly myReview = computed(() => this.viewer()?.my_review ?? null);

  writeReview(): void {
    const p = this.property();
    if (!p || !this.canReview()) return;
    this.dialog
      .open<ReviewDialog, ReviewDialogData, Review>(ReviewDialog, {
        data: { propertyId: p.id, propertyTitle: p.title },
        width: '520px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((review) => {
        if (!review) return;
        this.postedReview.set({
          id: p.id,
          viewer: { can_review: false, my_review: { id: review.id, rating: review.rating, comment: review.comment, created_at: review.created_at } },
        });
        this.reviewsList()?.reload();
        this.snackBar.open('Thanks - your review is posted.', 'OK', { duration: 5000 });
      });
  }

  /** Header "★ 4.5 · 2 reviews": scroll to the Reviews section (no URL change, so
   *  the query params that hold the chosen stay stay as they are). */
  goToReviews(event: Event): void {
    event.preventDefault();
    const el = this.reviewsSection()?.nativeElement;
    if (!el) return;
    el.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  }

  onCalendar(sel: DateSelection): void {
    this.form.controls.dates.setValue({ start: sel.start, end: sel.end });
  }

  /** Booked nights can't be chosen in the panel's picker either. */
  readonly pickerFilter = computed(() => stayDateFilter(this.booked(), this.checkIn(), this.checkOut()));

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
