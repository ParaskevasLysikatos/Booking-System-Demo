import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, filter, map, of, startWith, switchMap } from 'rxjs';

import { parseApiErrors } from '../../core/api-errors';
import { formatDeadline } from '../../core/bookings/booking-policy';
import { Booking, BookingListQuery, BookingStatus } from '../../core/bookings/booking.models';
import { BookingService } from '../../core/bookings/booking.service';
import { parseIsoDate, todayLocal } from '../../core/dates';
import { formatPrice } from '../../core/money';
import { DEFAULT_PAGE_SIZE, Paginated } from '../../core/properties/property.models';
import { BrowserRedirect } from '../../core/payments/browser-redirect';
import { clockSignal, clockTime, formatRemaining, remainingMs } from '../../core/payments/countdown';
import { refundDue } from '../../core/payments/payment-labels';
import { PaymentService } from '../../core/payments/payment.service';
import { CancelBookingDialog } from './cancel-dialog';

export type BookingsTab = 'upcoming' | 'past' | 'cancelled';

interface TabConfig {
  key: BookingsTab;
  label: string;
  query: BookingListQuery;
  empty: string;
}

/** Tabs (agreed): Upcoming / Past = not cancelled; Cancelled = any date. Always ?mine=true. */
export const TABS: TabConfig[] = [
  { key: 'upcoming', label: 'Upcoming', query: { when: 'upcoming', statuses: ['pending', 'confirmed'] }, empty: 'No upcoming trips yet.' },
  { key: 'past', label: 'Past', query: { when: 'past', statuses: ['pending', 'confirmed'] }, empty: 'No past trips yet.' },
  { key: 'cancelled', label: 'Cancelled', query: { statuses: ['cancelled'] }, empty: 'No cancelled bookings.' },
];

type ListState =
  | { status: 'loading' }
  | { status: 'ok'; data: Paginated<Booking> }
  | { status: 'error' };

const STATUS_LABEL: Record<BookingStatus, string> = { pending: 'Pending', confirmed: 'Confirmed', cancelled: 'Cancelled' };

/** /my-bookings (TICKET-021) - the logged-in user's own bookings. Guarded by authGuard. */
@Component({
  selector: 'app-my-bookings',
  imports: [MatButtonModule, MatIconModule, MatPaginatorModule, MatProgressSpinnerModule, MatTabsModule, RouterLink],
  templateUrl: './my-bookings.html',
  styleUrl: './my-bookings.scss',
})
export class MyBookingsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly bookings = inject(BookingService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly payments = inject(PaymentService);
  private readonly redirect = inject(BrowserRedirect);

  /** One ticking clock for every hold countdown on the page (TICKET-029). */
  private readonly clock = clockSignal();

  readonly tabs = TABS;
  readonly pageSize = DEFAULT_PAGE_SIZE;
  readonly statusLabel = STATUS_LABEL;
  readonly formatPrice = formatPrice;

  /** Tab + page live in the URL (?tab=past&page=2): reload/Back keep them. */
  private readonly view$ = this.route.queryParamMap.pipe(
    map((q) => {
      const tab = (TABS.find((t) => t.key === q.get('tab'))?.key ?? 'upcoming') as BookingsTab;
      const page = Math.max(1, Number(q.get('page')) || 1);
      return { tab, page };
    }),
  );
  readonly view = toSignal(this.view$, { requireSync: true });

  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  readonly state = toSignal(
    combineLatest([this.view$, this.refresh$]).pipe(
      switchMap(([view]) => {
        const tab = TABS.find((t) => t.key === view.tab)!;
        return this.bookings.list({ ...tab.query, mine: true, page: view.page }).pipe(
          map((data): ListState => ({ status: 'ok', data })),
          catchError(() => of<ListState>({ status: 'error' })),
          startWith<ListState>({ status: 'loading' }),
        );
      }),
    ),
    { initialValue: { status: 'loading' } as ListState },
  );

  readonly okData = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.data : null;
  });

  /** Id of the booking whose cancel request is in flight (disables its button). */
  readonly cancelling = signal<number | null>(null);
  /** Id of the booking whose "Pay now" is opening Stripe's page. */
  readonly paying = signal<number | null>(null);

  constructor() {
    inject(Title).setTitle('My bookings · Booking System Demo');
  }

  tabIndex(): number {
    return TABS.findIndex((t) => t.key === this.view().tab);
  }

  emptyText(): string {
    return TABS[this.tabIndex()].empty;
  }

  selectTab(index: number): void {
    const key = TABS[index]?.key ?? 'upcoming';
    void this.router.navigate([], { relativeTo: this.route, queryParams: { tab: key === 'upcoming' ? null : key, page: null } });
  }

  onPage(event: PageEvent): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: event.pageIndex > 0 ? event.pageIndex + 1 : null },
      queryParamsHandling: 'merge',
    });
  }

  retry(): void {
    this.refresh$.next();
  }

  /** Ask first (dialog), then PATCH. The server has the final word on the 48h rule. */
  cancel(booking: Booking): void {
    if (this.cancelling() !== null) return;
    this.dialog
      .open<CancelBookingDialog, Booking, boolean>(CancelBookingDialog, { data: booking, width: '480px', autoFocus: 'dialog' })
      .afterClosed()
      .pipe(filter((yes) => yes === true))
      .subscribe(() => {
        this.cancelling.set(booking.id);
        this.bookings.cancel(booking.id).subscribe({
          next: () => {
            this.cancelling.set(null);
            this.snackBar.open(`Booking #${booking.id} cancelled.`, 'OK', { duration: 5000 });
            this.refresh$.next(); // it leaves this tab and shows under "Cancelled"
          },
          error: (err) => {
            this.cancelling.set(null);
            const parsed = parseApiErrors(err);
            const message = parsed.general ?? Object.values(parsed.fields).flat().join(' ');
            this.snackBar.open(message || "Couldn't cancel this booking.", 'OK', { duration: 8000 });
            this.refresh$.next(); // e.g. the deadline passed meanwhile - show the current state
          },
        });
      });
  }

  /** Pay now (TICKET-029): back to the booking's Stripe page while its hold runs. */
  payNow(booking: Booking): void {
    if (this.paying() !== null) return;
    this.paying.set(booking.id);
    this.payments.checkout(booking.id).subscribe({
      next: (res) => this.redirect.to(res.checkout_url),
      error: (err) => {
        this.paying.set(null);
        this.snackBar.open(parseApiErrors(err).general ?? "Couldn't open the payment page.", 'OK', { duration: 8000 });
        this.refresh$.next(); // e.g. it was paid or released meanwhile
      },
    });
  }

  // --- payment display (TICKET-029) ---------------------------------------

  /** Ms left on an unpaid booking's date hold (ticks every second). */
  holdLeft(b: Booking): number {
    return b.payment?.status === 'open' ? remainingMs(b.payment.expires_at, this.clock()) : 0;
  }

  holdLeftText(b: Booking): string {
    return formatRemaining(this.holdLeft(b));
  }

  readonly refundDue = refundDue;
  readonly clockTime = clockTime;

  // --- display helpers ----------------------------------------------------

  date(iso: string): string {
    return parseIsoDate(iso)!.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  bookedOn(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  deadline(iso: string): string {
    return formatDeadline(new Date(iso));
  }

  /** Checked in but not yet checked out. */
  isOngoing(b: Booking): boolean {
    const today = todayLocal();
    return b.status !== 'cancelled' && parseIsoDate(b.check_in)! <= today && parseIsoDate(b.check_out)! > today;
  }

  isUpcoming(b: Booking): boolean {
    return parseIsoDate(b.check_out)! > todayLocal();
  }
}
