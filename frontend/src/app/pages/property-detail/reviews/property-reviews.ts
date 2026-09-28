import { Component, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BehaviorSubject, catchError, combineLatest, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';

import { RatingSummary, Review, ReviewPage } from '../../../core/reviews/review.models';
import { ReviewService } from '../../../core/reviews/review.service';
import { StarRatingComponent } from '../../../shared/star-rating';

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; page: ReviewPage };

/**
 * The Reviews section of the property page (TICKET-032, step 2): the star
 * summary (average + how many reviews gave each rating) and the reviews,
 * 5 at a time with "Show more reviews".
 *
 * It loads its own data from `GET /api/properties/{id}/reviews/`, so the
 * property page stays one request and the reviews can be re-read on their
 * own (`reload()`, used after posting a review in step 3).
 */
@Component({
  selector: 'app-property-reviews',
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, StarRatingComponent],
  templateUrl: './property-reviews.html',
  styleUrl: './property-reviews.scss',
})
export class PropertyReviewsComponent {
  private readonly reviewsApi = inject(ReviewService);

  readonly propertyId = input.required<number>();
  /** The latest summary from the API - the page's header uses it, so it updates after a review is posted. */
  readonly summaryChange = output<RatingSummary>();

  private readonly reload$ = new BehaviorSubject<void>(undefined);

  /** Page 1 + the summary. */
  readonly state = signal<LoadState>({ status: 'loading' });
  /** Everything loaded so far (page 1 + every "Show more"). */
  readonly reviews = signal<Review[]>([]);
  readonly summary = signal<RatingSummary | null>(null);
  readonly total = signal(0);

  readonly loadingMore = signal(false);
  readonly moreFailed = signal(false);
  private readonly nextPage = signal<number | null>(null);

  readonly hasMore = computed(() => this.nextPage() !== null && this.reviews().length < this.total());

  /** Bar length per star rating: share of all reviews (0-100). */
  readonly bars = computed(() => {
    const s = this.summary();
    if (!s || !s.review_count) return [];
    return s.breakdown.map((row) => ({ ...row, pct: (row.count / s.review_count) * 100 }));
  });

  constructor() {
    combineLatest([toObservable(this.propertyId).pipe(distinctUntilChanged()), this.reload$])
      .pipe(
        switchMap(([id]) =>
          this.reviewsApi.forProperty(id).pipe(
            map((page): LoadState => ({ status: 'ok', page })),
            catchError(() => of<LoadState>({ status: 'error' })),
            startWith<LoadState>({ status: 'loading' }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((state) => {
        this.state.set(state);
        if (state.status !== 'ok') return;
        this.reviews.set(state.page.results);
        this.applyPage(state.page, 1);
        this.moreFailed.set(false);
      });
  }

  /** Re-read from page 1 (after an error, or after the caller posts a review). */
  reload(): void {
    this.reload$.next();
  }

  showMore(): void {
    const page = this.nextPage();
    if (!page || this.loadingMore()) return;
    this.loadingMore.set(true);
    this.moreFailed.set(false);
    this.reviewsApi.forProperty(this.propertyId(), page).subscribe({
      next: (res) => {
        // A review posted meanwhile shifts the pages by one - skip what we already show.
        const seen = new Set(this.reviews().map((r) => r.id));
        this.reviews.update((list) => [...list, ...res.results.filter((r) => !seen.has(r.id))]);
        this.applyPage(res, page);
        this.loadingMore.set(false);
      },
      error: () => {
        this.loadingMore.set(false);
        this.moreFailed.set(true);
      },
    });
  }

  /** "September 2026" - reviews show the month, like most booking sites. */
  month(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  initial(name: string): string {
    return name.trim().charAt(0).toUpperCase() || '?';
  }

  private applyPage(page: ReviewPage, pageNumber: number): void {
    this.summary.set(page.summary);
    this.summaryChange.emit(page.summary);
    this.total.set(page.count);
    this.nextPage.set(page.next ? pageNumber + 1 : null);
  }
}
