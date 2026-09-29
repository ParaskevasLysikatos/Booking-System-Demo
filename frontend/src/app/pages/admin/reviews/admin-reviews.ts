import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, debounceTime, distinctUntilChanged, filter, map, of, startWith, switchMap } from 'rxjs';

import { AdminPropertiesService } from '../../../core/admin/admin-properties.service';
import { AdminReview, AdminReviewQuery, AdminReviewsService, ReviewVisibility } from '../../../core/admin/admin-reviews.service';
import { parseApiErrors } from '../../../core/api-errors';
import { DEFAULT_PAGE_SIZE, Paginated } from '../../../core/properties/property.models';
import { ConfirmDialog, ConfirmDialogData } from '../../../shared/confirm-dialog';
import { StarRatingComponent } from '../../../shared/star-rating';
import { providePaginatorI18n } from '../../../core/i18n/paginator-i18n';
import { formatDate } from '../../../core/i18n/format';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { translate } from '../../../core/i18n/translation.service';

export interface AdminReviewsUrlQuery {
  visibility: ReviewVisibility;
  rating: number | null;
  property: number | null;
  search: string;
  page: number;
}

const VISIBILITIES: ReviewVisibility[] = ['all', 'visible', 'hidden'];

/** URL (?status=hidden&rating=1&property=4&search=noisy&page=2) -> query; junk falls back to defaults. */
export function parseAdminReviewsQuery(q: { get(name: string): string | null }): AdminReviewsUrlQuery {
  const status = q.get('status') as ReviewVisibility | null;
  const rating = Number(q.get('rating'));
  const property = Number(q.get('property'));
  return {
    visibility: status && VISIBILITIES.includes(status) ? status : 'all',
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    property: Number.isInteger(property) && property > 0 ? property : null,
    search: (q.get('search') ?? '').trim(),
    page: Math.max(1, Number(q.get('page')) || 1),
  };
}

type ListState = { status: 'loading' } | { status: 'ok'; data: Paginated<AdminReview> } | { status: 'error' };

/**
 * /admin/reviews (TICKET-032, step 4) - every review, hidden ones too,
 * with Hide / Show again. Hiding never deletes: the review leaves the
 * public list and the property's rating, and the guest still can't post
 * another one.
 */
@Component({
  selector: 'app-admin-reviews',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatSelectModule,
    MatTableModule,
    StarRatingComponent,
    TranslatePipe,
  ],
  templateUrl: './admin-reviews.html',
  providers: [providePaginatorI18n()], // the paginator's texts in the chosen language (TICKET-038)
  styleUrl: './admin-reviews.scss',
})
export class AdminReviewsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly reviews = inject(AdminReviewsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly columns = ['date', 'property', 'guest', 'rating', 'comment', 'status', 'actions'];
  readonly pageSize = DEFAULT_PAGE_SIZE;
  readonly ratings = [5, 4, 3, 2, 1];

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

  private readonly query$ = this.route.queryParamMap.pipe(map(parseAdminReviewsQuery));
  readonly query = toSignal(this.query$, { requireSync: true });
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  readonly state = toSignal(
    combineLatest([this.query$, this.refresh$]).pipe(
      switchMap(([q]) =>
        this.reviews.list(this.toApi(q)).pipe(
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
  readonly filtered = computed(() => {
    const q = this.query();
    return q.visibility !== 'all' || q.rating !== null || q.property !== null || !!q.search;
  });

  readonly search = new FormControl('', { nonNullable: true });
  /** Id of the review whose hide/show request is in flight. */
  readonly busy = signal<number | null>(null);

  constructor() {
    this.query$.pipe(takeUntilDestroyed()).subscribe((q) => this.search.setValue(q.search, { emitEvent: false }));
    this.search.valueChanges
      .pipe(debounceTime(300), map((v) => v.trim()), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((search) => this.update({ search, page: 1 }));
  }

  setVisibility(visibility: ReviewVisibility): void {
    this.update({ visibility, page: 1 });
  }

  setRating(rating: number | null): void {
    this.update({ rating, page: 1 });
  }

  setProperty(property: number | null): void {
    this.update({ property, page: 1 });
  }

  clearFilters(): void {
    this.update({ visibility: 'all', rating: null, property: null, search: '', page: 1 });
  }

  onPage(e: PageEvent): void {
    this.update({ page: e.pageIndex + 1 });
  }

  retry(): void {
    this.refresh$.next();
  }

  /** Hide (or show again) - always asked first, then PATCH is_hidden. */
  toggleHidden(r: AdminReview): void {
    if (this.busy() !== null) return;
    const hide = !r.is_hidden;
    const who = translate('adminReviews.who', { name: r.author_name, rating: r.rating, title: r.property.title });
    const data: ConfirmDialogData = hide
      ? {
          title: translate('adminReviews.hideDialog.title'),
          message: translate('adminReviews.hideDialog.message', { who }),
          confirmLabel: translate('adminReviews.hideDialog.confirm'),
          cancelLabel: translate('adminReviews.hideDialog.keep'),
          danger: true,
        }
      : {
          title: translate('adminReviews.showDialog.title'),
          message: translate('adminReviews.showDialog.message', { who }),
          confirmLabel: translate('adminReviews.showDialog.confirm'),
          cancelLabel: translate('adminReviews.showDialog.keep'),
        };
    this.dialog
      .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, { data, width: '480px' })
      .afterClosed()
      .pipe(filter((yes) => yes === true))
      .subscribe(() => {
        this.busy.set(r.id);
        this.reviews.setHidden(r.id, hide).subscribe({
          next: () => {
            this.busy.set(null);
            this.snackBar.open(translate(hide ? 'adminReviews.hiddenDone' : 'adminReviews.shownDone'), translate('common.ok'), { duration: 4000 });
            this.refresh$.next();
          },
          error: (err) => {
            this.busy.set(null);
            const parsed = parseApiErrors(err);
            const message = parsed.general ?? Object.values(parsed.fields).flat().join(' ');
            this.snackBar.open(message || translate('adminReviews.changeFailed'), translate('common.ok'), { duration: 7000 });
            this.refresh$.next();
          },
        });
      });
  }

  date(iso: string): string {
    return formatDate(iso, 'medium');
  }

  private toApi(q: AdminReviewsUrlQuery): AdminReviewQuery {
    return { visibility: q.visibility, rating: q.rating, property: q.property, search: q.search, page: q.page };
  }

  private update(changes: Partial<AdminReviewsUrlQuery>): void {
    const next = { ...this.query(), ...changes };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        status: next.visibility === 'all' ? null : next.visibility,
        rating: next.rating,
        property: next.property,
        search: next.search || null,
        page: next.page > 1 ? next.page : null,
      },
    });
  }
}
