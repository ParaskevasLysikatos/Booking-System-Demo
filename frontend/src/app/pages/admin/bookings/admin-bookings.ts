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
import { AdminPropertiesService } from '../../../core/admin/admin-properties.service';
import { parseApiErrors } from '../../../core/api-errors';
import { Booking, BookingListQuery, BookingStatus } from '../../../core/bookings/booking.models';
import { BookingService } from '../../../core/bookings/booking.service';
import { parseIsoDate, todayLocal } from '../../../core/dates';
import { formatPrice } from '../../../core/money';
import { DEFAULT_PAGE_SIZE, Paginated } from '../../../core/properties/property.models';
import { ConfirmDialog, ConfirmDialogData } from '../../../shared/confirm-dialog';

export type AdminBookingsTab = 'upcoming' | 'past' | 'cancelled';

export interface AdminBookingsQuery {
  tab: AdminBookingsTab;
  search: string;
  property: number | null;
  pendingOnly: boolean;
  page: number;
}

export const ADMIN_BOOKING_TABS: { key: AdminBookingsTab; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function parseAdminBookingsQuery(q: { get(name: string): string | null }): AdminBookingsQuery {
  const tab = (ADMIN_BOOKING_TABS.find((t) => t.key === q.get('tab'))?.key ?? 'upcoming') as AdminBookingsTab;
  const property = Number(q.get('property'));
  return {
    tab,
    search: (q.get('search') ?? '').trim(),
    property: Number.isInteger(property) && property > 0 ? property : null,
    pendingOnly: tab !== 'cancelled' && q.get('pending') === '1',
    page: Math.max(1, Number(q.get('page')) || 1),
  };
}

/** URL query -> API query: everyone's bookings (no `mine`), split like My Bookings. */
export function toApiQuery(q: AdminBookingsQuery): BookingListQuery {
  const statuses: BookingStatus[] =
    q.tab === 'cancelled' ? ['cancelled'] : q.pendingOnly ? ['pending'] : ['pending', 'confirmed'];
  return {
    when: q.tab === 'cancelled' ? undefined : q.tab,
    statuses,
    search: q.search || undefined,
    property: q.property ?? undefined,
    page: q.page,
  };
}

type ListState = { status: 'loading' } | { status: 'ok'; data: Paginated<Booking> } | { status: 'error' };

const STATUS_LABEL: Record<BookingStatus, string> = { pending: 'Pending', confirmed: 'Confirmed', cancelled: 'Cancelled' };

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
  ],
  templateUrl: './admin-bookings.html',
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
  readonly columns = ['ref', 'guest', 'property', 'dates', 'guests', 'total', 'status', 'booked', 'actions'];
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
        this.bookings.list(toApiQuery(q)).pipe(
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
    this.update({ tab, page: 1, pendingOnly: tab === 'cancelled' ? false : this.query().pendingOnly });
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
    this.ask({
      title: `Confirm booking #${b.id}?`,
      message: `${b.property.title}, ${this.range(b)} for ${b.guest_email ?? 'the guest'} (${b.guests} ${b.guests === 1 ? 'guest' : 'guests'}, ${formatPrice(b.total_price)}). The guest will see it as Confirmed.`,
      confirmLabel: 'Confirm booking',
      cancelLabel: 'Not now',
    }).subscribe(() => this.run(b, this.bookings.confirm(b.id), `Booking #${b.id} confirmed.`));
  }

  cancelBooking(b: Booking): void {
    this.ask({
      title: `Cancel booking #${b.id}?`,
      message: `${b.property.title}, ${this.range(b)} for ${b.guest_email ?? 'the guest'}. The dates will be released and this can't be undone. No payment is taken yet, so there's nothing to refund.`,
      confirmLabel: 'Cancel booking',
      cancelLabel: 'Keep booking',
      danger: true,
    }).subscribe(() => this.run(b, this.bookings.cancel(b.id), `Booking #${b.id} cancelled.`));
  }

  // --- display helpers ----------------------------------------------------

  label(status: BookingStatus): string {
    return STATUS_LABEL[status];
  }

  date(iso: string, year = false): string {
    return parseIsoDate(iso)!.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
  }

  range(b: Booking): string {
    return `${this.date(b.check_in)} – ${this.date(b.check_out, true)}`;
  }

  bookedOn(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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

  private run(b: Booking, request: Observable<Booking>, success: string): void {
    this.busy.set(b.id);
    request.subscribe({
      next: () => {
        this.busy.set(null);
        this.snackBar.open(success, 'OK', { duration: 4000 });
        this.refresh$.next();
        this.badges.refresh();
      },
      error: (err) => {
        this.busy.set(null);
        const parsed = parseApiErrors(err);
        const message = parsed.general ?? Object.values(parsed.fields).flat().join(' ');
        // e.g. someone else changed it meanwhile - show why and the current state
        this.snackBar.open(message || 'Something went wrong. Please try again.', 'OK', { duration: 7000 });
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
        pending: next.pendingOnly && next.tab !== 'cancelled' ? 1 : null,
        page: next.page > 1 ? next.page : null,
      },
    });
  }
}
