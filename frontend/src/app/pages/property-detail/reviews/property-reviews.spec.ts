import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PROPERTIES_URL } from '../../../core/properties/property.service';
import { Review, ReviewPage } from '../../../core/reviews/review.models';
import { PropertyReviewsComponent } from './property-reviews';

const URL = `${PROPERTIES_URL}5/reviews/`;

const review = (id: number, overrides: Partial<Review> = {}): Review => ({
  id, rating: 5, comment: `Comment ${id}`, author_name: 'Maria K.', created_at: '2026-09-20T10:00:00Z', ...overrides,
});

const page = (results: Review[], count: number, next: string | null = null): ReviewPage => ({
  count, next, previous: null, results,
  summary: {
    rating_avg: 4.3, review_count: count,
    breakdown: [{ rating: 5, count: 4 }, { rating: 4, count: 1 }, { rating: 3, count: 2 }, { rating: 2, count: 0 }, { rating: 1, count: 0 }],
  },
});

describe('PropertyReviewsComponent', () => {
  let fixture: ComponentFixture<PropertyReviewsComponent>;
  let http: HttpTestingController;

  function create() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PropertyReviewsComponent);
    fixture.componentRef.setInput('propertyId', 5);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent!.replace(/\s+/g, ' ');
  const pageReq = (n: number) =>
    http.expectOne((r) => r.url === URL && (n === 1 ? !r.params.has('page') : r.params.get('page') === String(n)));
  const button = (label: string) =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent!.includes(label)) as HTMLButtonElement | undefined;

  it('shows the summary, the per-star bars and the first reviews', () => {
    create();
    expect(el().querySelector('[aria-label="Loading reviews"]')).toBeTruthy();
    pageReq(1).flush(page([review(1, { comment: 'Spotless and central.' }), review(2, { rating: 3, comment: '' })], 7, `${URL}?page=2`));
    fixture.detectChanges();

    expect(text()).toContain('4.3');
    expect(text()).toContain('7 reviews');
    const bars = Array.from(el().querySelectorAll('.bars li'));
    expect(bars.map((b) => b.getAttribute('aria-label'))).toEqual([
      '5 stars: 4 reviews', '4 stars: 1 review', '3 stars: 2 reviews', '2 stars: 0 reviews', '1 star: 0 reviews',
    ]);
    expect((bars[0].querySelector('.fill') as HTMLElement).style.width).toMatch(/^57\.14/);
    expect(text()).toContain('Maria K.');
    expect(text()).toContain('September 2026');
    expect(text()).toContain('Spotless and central.');
    expect(el().querySelectorAll('.review').length).toBe(2);
    expect(el().querySelectorAll('.review .comment').length).toBe(1); // empty comment: stars only
    expect(text()).toContain('Showing 2 of 7');
  });

  it('"Show more reviews" appends the next page, skips duplicates and disappears at the end', () => {
    create();
    pageReq(1).flush(page([review(1), review(2)], 4, `${URL}?page=2`));
    fixture.detectChanges();

    button('Show more reviews')!.click();
    fixture.detectChanges();
    expect(button('Show more')).toBeUndefined(); // spinner while loading
    // a review posted meanwhile shifted the pages: #2 comes again
    pageReq(2).flush(page([review(2), review(3), review(4)], 4));
    fixture.detectChanges();

    expect(Array.from(el().querySelectorAll('.review .comment')).map((c) => c.textContent)).toEqual([
      'Comment 1', 'Comment 2', 'Comment 3', 'Comment 4',
    ]);
    expect(button('Show more reviews')).toBeUndefined();
    expect(text()).not.toContain('Showing');
  });

  it('a failed "Show more" keeps what is shown and offers Try again', () => {
    create();
    pageReq(1).flush(page([review(1)], 6, `${URL}?page=2`));
    fixture.detectChanges();
    button('Show more reviews')!.click();
    pageReq(2).flush('down', { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    expect(text()).toContain("Couldn't load more reviews.");
    expect(el().querySelectorAll('.review').length).toBe(1);
    button('Try again')!.click();
    pageReq(2).flush(page([review(2)], 6, `${URL}?page=3`));
    fixture.detectChanges();
    expect(el().querySelectorAll('.review').length).toBe(2);
    expect(text()).not.toContain("Couldn't load more");
  });

  it('no reviews yet', () => {
    create();
    pageReq(1).flush({ ...page([], 0), summary: { rating_avg: null, review_count: 0, breakdown: [] } });
    fixture.detectChanges();
    expect(text()).toContain('No reviews yet');
    expect(el().querySelector('.bars')).toBeNull();
  });

  it('an error shows Try again, which reloads', () => {
    create();
    pageReq(1).flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(text()).toContain("Couldn't load the reviews.");
    button('Try again')!.click();
    pageReq(1).flush(page([review(1)], 1));
    fixture.detectChanges();
    expect(text()).toContain('1 review');
    http.verify();
  });
});
