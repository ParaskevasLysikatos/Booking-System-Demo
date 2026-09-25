import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, debounceTime, distinctUntilChanged, filter, map, of, startWith, switchMap } from 'rxjs';

import { AdminPropertiesService, PropertyStatusFilter } from '../../../core/admin/admin-properties.service';
import { parseApiErrors } from '../../../core/api-errors';
import { formatPrice } from '../../../core/money';
import { Paginated, PropertyOrdering, PropertySummary } from '../../../core/properties/property.models';
import { ConfirmDialog, ConfirmDialogData } from '../../../shared/confirm-dialog';

export interface AdminListQuery {
  status: PropertyStatusFilter;
  search: string;
  ordering: PropertyOrdering;
  page: number;
}

export const ADMIN_PAGE_SIZE = 12;
const ORDERINGS: PropertyOrdering[] = ['newest', 'price', '-price', 'capacity', '-capacity'];

export function parseAdminListQuery(q: { get(name: string): string | null }): AdminListQuery {
  const status = q.get('status') as PropertyStatusFilter | null;
  const ordering = q.get('ordering') as PropertyOrdering | null;
  return {
    status: status === 'active' || status === 'retired' ? status : 'all',
    search: (q.get('search') ?? '').trim(),
    ordering: ordering && ORDERINGS.includes(ordering) ? ordering : 'newest',
    page: Math.max(1, Number(q.get('page')) || 1),
  };
}

type ListState = { status: 'loading' } | { status: 'ok'; data: Paginated<PropertySummary> } | { status: 'error' };

/** /admin/properties (TICKET-024) - every property (active + retired) with edit / retire / reactivate. */
@Component({
  selector: 'app-admin-property-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatPaginatorModule,
    MatSelectModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './admin-property-list.html',
  styleUrl: './admin-property-list.scss',
})
export class AdminPropertyListPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(AdminPropertiesService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly columns = ['photo', 'title', 'location', 'price', 'capacity', 'rating', 'status', 'actions'];
  readonly pageSize = ADMIN_PAGE_SIZE;
  readonly formatPrice = formatPrice;
  readonly sortOptions: { value: PropertyOrdering; label: string }[] = [
    { value: 'newest', label: 'Newest' },
    { value: 'price', label: 'Price: low to high' },
    { value: '-price', label: 'Price: high to low' },
    { value: '-capacity', label: 'Most guests' },
  ];

  /** Status, search, sort and page all live in the URL. */
  private readonly query$ = this.route.queryParamMap.pipe(map(parseAdminListQuery));
  readonly query = toSignal(this.query$, { requireSync: true });
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  readonly state = toSignal(
    combineLatest([this.query$, this.refresh$]).pipe(
      switchMap(([q]) =>
        this.api.list({ ...q, pageSize: ADMIN_PAGE_SIZE }).pipe(
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
  /** Id of the property whose retire/reactivate request is in flight. */
  readonly busy = signal<number | null>(null);

  constructor() {
    this.query$.pipe(takeUntilDestroyed()).subscribe((q) => this.search.setValue(q.search, { emitEvent: false }));
    this.search.valueChanges
      .pipe(debounceTime(300), map((v) => v.trim()), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((search) => this.update({ search, page: 1 }));
  }

  setStatus(status: PropertyStatusFilter): void {
    this.update({ status, page: 1 });
  }

  setOrdering(ordering: PropertyOrdering): void {
    this.update({ ordering, page: 1 });
  }

  onPage(e: PageEvent): void {
    this.update({ page: e.pageIndex + 1 });
  }

  retry(): void {
    this.refresh$.next();
  }

  retire(p: PropertySummary): void {
    this.confirm({
      title: `Retire "${p.title}"?`,
      message:
        "It will be hidden from guests and can't be booked any more. Existing bookings, reviews and stats are kept, and you can reactivate it at any time.",
      confirmLabel: 'Retire property',
      danger: true,
    })
      .pipe(filter(Boolean))
      .subscribe(() => this.run(p, this.api.retire(p.id), `"${p.title}" retired - hidden from guests.`));
  }

  reactivate(p: PropertySummary): void {
    this.run(p, this.api.reactivate(p.id), `"${p.title}" is active again.`);
  }

  rating(p: PropertySummary): string {
    return p.rating_avg ? `★ ${p.rating_avg.toFixed(1)} (${p.review_count})` : 'New';
  }

  private run(p: PropertySummary, request: Observable<unknown>, success: string): void {
    this.busy.set(p.id);
    request.subscribe({
      next: () => {
        this.busy.set(null);
        this.snackBar.open(success, 'OK', { duration: 4000 });
        this.refresh$.next();
      },
      error: (err) => {
        this.busy.set(null);
        const parsed = parseApiErrors(err);
        this.snackBar.open(parsed.general ?? 'Something went wrong. Please try again.', 'OK', { duration: 6000 });
      },
    });
  }

  private confirm(data: ConfirmDialogData): Observable<boolean> {
    return this.dialog
      .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, { data, width: '460px' })
      .afterClosed()
      .pipe(map((yes) => yes === true));
  }

  private update(changes: Partial<AdminListQuery>): void {
    const next = { ...this.query(), ...changes };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        status: next.status === 'all' ? null : next.status,
        search: next.search || null,
        ordering: next.ordering === 'newest' ? null : next.ordering,
        page: next.page > 1 ? next.page : null,
      },
    });
  }
}
