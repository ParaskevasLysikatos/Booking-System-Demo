import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, debounceTime, distinctUntilChanged, filter, map, of, startWith, switchMap } from 'rxjs';

import { AdminBadgesService } from '../../../core/admin/admin-badges.service';
import { ClosedDatesTabComponent } from './closed-dates-tab';
import { AdminPropertiesService } from '../../../core/admin/admin-properties.service';
import { parseApiErrors } from '../../../core/api-errors';
import { Booking, BookingListQuery, BookingStatus } from '../../../core/bookings/booking.models';
import { BookingService } from '../../../core/bookings/booking.service';
import { parseIsoDate, todayLocal } from '../../../core/dates';
import { formatPrice } from '../../../core/money';
import { DEFAULT_PAGE_SIZE, Paginated } from '../../../core/properties/property.models';
import { clockTime } from '../../../core/payments/countdown';
import { paymentLabel, refundView } from '../../../core/payments/payment-labels';
import { ConfirmDialog, ConfirmDialogData } from '../../../shared/confirm-dialog';
import { providePaginatorI18n } from '../../../core/i18n/paginator-i18n';
import { formatDate } from '../../../core/i18n/format';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { translate } from '../../../core/i18n/translation.service';

/** `closed` (TICKET-045): every property's closed dates, not bookings. */
export type AdminBookingsTab = 'upcoming' | 'past' | 'cancelled' | 'closed';

export interface AdminBookingsQuery {
  tab: AdminBookingsTab;
  search: string;
  property: number | null;
  pendingOnly: boolean;
  page: number;
}

export const ADMIN_BOOKING_TABS: { key: AdminBookingsTab; label: string }[] = [
  // `label` is a dictionary key (TICKET-038).
  { key: 'upcoming', label: 'myBookings.tab.upcoming' },
  { key: 'past', label: 'myBookings.tab.past' },
  { key: 'cancelled', label: 'myBookings.tab.cancelled' },
  { key: 'closed', label: 'closedDates.tab' }, // TICKET-045 (short: four tabs on a phone)
];

export function parseAdminBookingsQuery(q: { get(name: string): string | null }): AdminBookingsQuery {
  const tab = (ADMIN_BOOKING_TABS.find((t) => t.key === q.get('tab'))?.key ?? 'upcoming') as AdminBookingsTab;
  const property = Number(q.get('property'));
  return {
    tab,
    search: (q.get('search') ?? '').trim(),
    property: Number.isInteger(property) && property > 0 ? property : null,
    pendingOnly: tab !== 'cancelled' && tab !== 'closed' && q.get('pending') === '1',
    page: Math.max(1, Number(q.get('page')) || 1),
  };
}

/** URL query -> API query: everyone's bookings (no `mine`), split like My Bookings. */
export function toApiQuery(q: AdminBookingsQuery): BookingListQuery {
  const statuses: BookingStatus[] =
    q.tab === 'cancelled' ? ['cancelled'] : q.pendingOnly ? ['pending'] : ['pending', 'confirmed'];
  return {
    when: q.tab === 'cancelled' || q.tab === 'closed' ? undefined : q.tab,
    statuses,
    search: q.search || undefined,
    property: q.property ?? undefined,
    page: q.page,
  };
}

type ListState = { status: 'loading' } | { status: 'ok'; data: Paginated<Booking> } | { status: 'error' };

/** A server reason as one sentence with exactly one full stop. */
function sentence(reason: string | null): string {
  return `${(reason ?? translate('adminBookings.unknownReason')).replace(/[.\s]+$/, '')}.`;
}


/** /admin/bookings (TICKET-025) - every guest's bookings, with Confirm / Cancel. */
@Component({
  selector: 'app-admin-bookings',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTableModule,
    MatTabsModule,
    MatTooltipModule,
    TranslatePipe,
    ClosedDatesTabComponent,
  ],
  templateUrl: './admin-bookings.html',
  providers: [providePaginatorI18n()], // the paginator's texts in the chosen language (TICKET-038)
  styleUrl: './admin-bookings.scss',
})
export class AdminBookingsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly bookings = inject(BookingService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly badges = inject(AdminBadgesService);

  readonly tabs = ADMIN_BOOKING_TABS;
  readonly columns = ['ref', 'guest', 'property', 'dates', 'guests', 'total', 'status', 'payment', 'booked', 'actions'];
  readonly pageSize = DEFAULT_PAGE_SIZE;
  readonly formatPrice = formatPrice;

  /** Property dropdown (up to 50 - plenty for the demo). */
  readonly propertyOptions = toSignal(
    inject(AdminPropertiesService)
      .list({ pageSize: 50 })
      .pipe(
        map((p) => p.results.map((r) => ({ id: r.id, title: r.title, active: r.is_active }))),
        catchError(() => of([])),
      ),
    { initialValue: [] as { id: number; title: string; active: boolean }[] },
  );

  private readonly query$ = this.route.queryParamMap.pipe(map(parseAdminBookingsQuery));
  readonly query = toSignal(this.query$, { requireSync: true });
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  readonly state = toSignal(
    combineLatest([this.query$, this.refresh$]).pipe(
      switchMap(([q]) =>
        // The Closed dates tab loads its own list (TICKET-045) - no bookings request.
        q.tab === 'closed' ? of<ListState>({ status: 'loading' }) : this.bookings.list(toApiQuery(q)).pipe(
          map((data): ListState => ({ status: 'ok', data })),
          catchError(() => of<ListState>({ status: 'error' })),
          startWith<ListState>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as ListState },
  );
  readonly data = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.data : null;
  });

  readonly search = new FormControl('', { nonNullable: true });
  readonly busy = signal<number | null>(null);

  constructor() {
    this.query$.pipe(takeUntilDestroyed()).subscribe((q) => this.search.setValue(q.search, { emitEvent: false }));
    this.search.valueChanges
      .pipe(debounceTime(300), map((v) => v.trim()), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((search) => this.update({ search, page: 1 }));
  }

  tabIndex(): number {
    return ADMIN_BOOKING_TABS.findIndex((t) => t.key === this.query().tab);
  }

  selectTab(index: number): void {
    const tab = ADMIN_BOOKING_TABS[index]?.key ?? 'upcoming';
    this.update({ tab, page: 1, pendingOnly: tab === 'cancelled' || tab === 'closed' ? false : this.query().pendingOnly });
  }

  setProperty(id: number | null): void {
    this.update({ property: id, page: 1 });
  }

  setPendingOnly(on: boolean): void {
    this.update({ pendingOnly: on, page: 1 });
  }

  onPage(e: PageEvent): void {
    this.update({ page: e.pageIndex + 1 });
  }

  retry(): void {
    this.refresh$.next();
  }

  confirmBooking(b: Booking): void {
    // TICKET-029: confirming a booking that is still waiting for the guest's
    // online payment waives it - the server closes their payment page first.
    const unpaid = b.payment?.status === 'open' ? translate('adminBookings.confirmDialog.unpaid') : '';
    this.ask({
      title: translate('adminBookings.confirmDialog.title', { id: b.id }),
      message: translate('adminBookings.confirmDialog.message', {
        title: b.property.title,
        range: this.range(b),
        guest: b.guest_email ?? translate('adminBookings.guestFor'),
        guests: translate('common.guests', { count: b.guests }),
        total: formatPrice(b.total_price),
        unpaid,
      }),
      confirmLabel: translate('booking.confirm'),
      cancelLabel: translate('adminBookings.notNow'),
    }).subscribe(() => this.run(b, this.bookings.confirm(b.id), translate('adminBookings.confirmed', { id: b.id })));
  }

  cancelBooking(b: Booking): void {
    this.ask({
      title: translate('adminBookings.cancelDialog.title', { id: b.id }),
      message: translate('adminBookings.cancelDialog.message', {
        title: b.property.title,
        range: this.range(b),
        guest: b.guest_email ?? translate('adminBookings.guestFor'),
        note: this.cancelPaymentNote(b),
      }),
      confirmLabel: translate('myBookings.cancel'),
      cancelLabel: translate('myBookings.dialog.keep'),
      danger: true,
    }).subscribe(() => this.run(b, this.bookings.cancel(b.id), (res) => this.cancelOutcome(res)));
  }

  /**
   * "Refund now" (TICKET-040): start or retry the full refund of a
   * cancelled, paid booking. The server makes sure it can never refund twice.
   */
  refundNow(b: Booking): void {
    const r = refundView(b);
    const last = r?.kind === 'failed' && r.reason ? translate('adminBookings.lastFailed', { reason: sentence(r.reason) }) : '';
    this.ask({
      title: translate('adminBookings.refundDialog.title', { id: b.id }),
      message: translate('adminBookings.refundDialog.message', {
        amount: formatPrice(b.payment?.amount ?? b.total_price),
        guest: b.guest_email ?? translate('adminBookings.guestName'),
        last,
      }),
      confirmLabel: translate('adminBookings.refundNow'),
      cancelLabel: translate('adminBookings.notNow'),
    }).subscribe(() => this.run(b, this.bookings.refund(b.id), (res) => this.refundOutcome(res)));
  }

  private cancelOutcome(res: Booking): string {
    const r = refundView(res);
    if (r?.kind === 'pending') return translate('adminBookings.outcome.refundSent', { id: res.id, amount: r.amount });
    if (r?.kind === 'failed') return translate('adminBookings.outcome.refundFailed', { id: res.id, reason: sentence(r.reason) });
    return translate('myBookings.cancelled', { id: res.id });
  }

  private refundOutcome(res: Booking): string {
    const r = refundView(res);
    if (r?.kind === 'failed') return translate('adminBookings.outcome.refundOnlyFailed', { id: res.id, reason: sentence(r.reason) });
    return translate('adminBookings.outcome.refundOnlySent', { id: res.id, amount: r?.amount ?? formatPrice(res.total_price) });
  }

  /** What cancelling means for the booking's money (TICKET-029). */
  private cancelPaymentNote(b: Booking): string {
    switch (b.payment?.status) {
      case 'paid':
        return b.payment.refund?.status === 'refunded'
          ? translate('adminBookings.note.alreadyRefunded', { amount: formatPrice(b.payment.amount) })
          : translate('adminBookings.note.willRefund', { amount: formatPrice(b.payment.amount) });
      case 'open':
        return translate('adminBookings.note.closePage');
      default:
        return translate('adminBookings.note.nothing');
    }
  }

  readonly paymentLabel = paymentLabel;
  readonly refundView = refundView;
  readonly clockTime = clockTime;

  // --- display helpers ----------------------------------------------------

  date(iso: string, year = false): string {
    return formatDate(iso, year ? 'medium' : 'dayMonth');
  }

  range(b: Booking): string {
    return `${this.date(b.check_in)} – ${this.date(b.check_out, true)}`;
  }

  bookedOn(iso: string): string {
    return formatDate(iso, 'medium');
  }

  isOngoing(b: Booking): boolean {
    const today = todayLocal();
    return b.status !== 'cancelled' && parseIsoDate(b.check_in)! <= today && parseIsoDate(b.check_out)! > today;
  }

  // --- internals ----------------------------------------------------------

  private ask(data: ConfirmDialogData): Observable<true> {
    return this.dialog
      .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, { data, width: '480px' })
      .afterClosed()
      .pipe(filter((yes): yes is true => yes === true));
  }

  private run(b: Booking, request: Observable<Booking>, success: string | ((result: Booking) => string)): void {
    this.busy.set(b.id);
    request.subscribe({
      next: (result) => {
        this.busy.set(null);
        const message = typeof success === 'string' ? success : success(result);
        this.snackBar.open(message, translate('common.ok'), { duration: typeof success === 'string' ? 4000 : 7000 });
        this.refresh$.next();
        this.badges.refresh();
      },
      error: (err) => {
        this.busy.set(null);
        const parsed = parseApiErrors(err);
        const message = parsed.general ?? Object.values(parsed.fields).flat().join(' ');
        // e.g. someone else changed it meanwhile - show why and the current state
        this.snackBar.open(message || translate('errors.generic'), translate('common.ok'), { duration: 7000 });
        this.refresh$.next();
        this.badges.refresh();
      },
    });
  }

  private update(changes: Partial<AdminBookingsQuery>): void {
    const next = { ...this.query(), ...changes };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        tab: next.tab === 'upcoming' ? null : next.tab,
        search: next.search || null,
        property: next.property,
        pending: next.pendingOnly && next.tab !== 'cancelled' && next.tab !== 'closed' ? 1 : null,
        page: next.page > 1 ? next.page : null,
      },
    });
  }
}
