import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, convertToParamMap, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';

import { ADMIN_REVIEWS_URL, AdminReview } from '../../../core/admin/admin-reviews.service';
import { PROPERTIES_URL } from '../../../core/properties/property.service';
import { AdminReviewsPage, parseAdminReviewsQuery } from './admin-reviews';

const review = (id: number, overrides: Partial<AdminReview> = {}): AdminReview => ({
  id, property: { id: 5, title: 'Harbour Loft' }, rating: 2, comment: 'Noisy street at night.', author_name: 'Maria K.',
  guest_email: 'maria@example.com', is_hidden: false, created_at: '2026-09-20T10:00:00Z', ...overrides,
});
const page = (results: AdminReview[], count = results.length) => ({ count, next: null, previous: null, results });

describe('admin reviews query', () => {
  it('parses the URL, dropping junk', () => {
    expect(parseAdminReviewsQuery(convertToParamMap({ status: 'hidden', rating: '1', property: '7', search: ' noisy ', page: '2' }))).toEqual({
      visibility: 'hidden', rating: 1, property: 7, search: 'noisy', page: 2,
    });
    expect(parseAdminReviewsQuery(convertToParamMap({ status: 'weird', rating: '9', property: 'x', page: '-3' }))).toEqual({
      visibility: 'all', rating: null, property: null, search: '', page: 1,
    });
  });
});

describe('AdminReviewsPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;
  let answer: boolean;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let snack: ReturnType<typeof vi.fn>;

  async function open(url = '/admin/reviews') {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: 'admin/reviews', component: AdminReviewsPage }])],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    answer = true;
    dialogOpen = vi.fn(() => ({ afterClosed: () => of(answer) }));
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockImplementation(dialogOpen as never);
    snack = vi.fn();
    vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockImplementation(snack as never);
    harness = await RouterTestingHarness.create();
    const cmp = await harness.navigateByUrl(url, AdminReviewsPage);
    http.expectOne((r) => r.url === PROPERTIES_URL).flush({ count: 1, next: null, previous: null, results: [{ id: 5, title: 'Harbour Loft', is_active: true }] });
    return cmp;
  }

  const listReq = (): TestRequest => http.expectOne((r) => r.url === ADMIN_REVIEWS_URL && r.method === 'GET');
  const el = () => harness.routeNativeElement as HTMLElement;
  const text = () => el().textContent!.replace(/\s+/g, ' ');
  async function settle() {
    harness.detectChanges();
    await harness.fixture.whenStable();
  }

  afterEach(() => http.verify());

  it('lists every review with guest, stars, comment and Visible/Hidden', async () => {
    await open();
    const req = listReq();
    expect(req.request.params.keys()).toEqual([]);
    req.flush(page([review(1), review(2, { is_hidden: true, rating: 1, comment: '' })]));
    await settle();
    expect(text()).toContain('2 reviews');
    expect(text()).toContain('Harbour Loft');
    expect(text()).toContain('Maria K.');
    expect(text()).toContain('maria@example.com');
    expect(text()).toContain('Noisy street at night.');
    expect(text()).toContain('No comment');
    expect(el().querySelector('[aria-label="2 out of 5 stars"]')).toBeTruthy();
    const rows = el().querySelectorAll('tr.mat-mdc-row');
    expect(rows[0].textContent).toContain('Visible');
    expect(rows[0].textContent).toContain('Hide');
    expect(rows[1].classList).toContain('hidden-row');
    expect(rows[1].textContent).toContain('Hidden');
    expect(rows[1].textContent).toContain('Show');
  });

  it('filters come from the URL and go to the API', async () => {
    await open('/admin/reviews?status=hidden&rating=1&property=5&search=noisy');
    const req = listReq();
    expect(req.request.params.toString()).toBe('hidden=true&rating=1&property=5&search=noisy');
    req.flush(page([]));
    await settle();
    expect(text()).toContain('No reviews match these filters.');
  });

  it('changing a filter updates the URL and starts again from page 1', async () => {
    const cmp = await open('/admin/reviews?page=3');
    listReq().flush(page([], 30));
    await settle();
    cmp.setVisibility('visible');
    await settle();
    expect(router.url).toBe('/admin/reviews?status=visible');
    listReq().flush(page([]));
    cmp.clearFilters();
    await settle();
    expect(router.url).toBe('/admin/reviews');
    listReq().flush(page([]));
  });

  it('Hide: asks first, PATCHes is_hidden, then a snackbar and a refresh', async () => {
    await open();
    listReq().flush(page([review(1)]));
    await settle();
    (el().querySelector('td.actions button') as HTMLButtonElement).click();
    expect(dialogOpen.mock.calls[0][1].data).toMatchObject({
      title: 'Hide this review?', confirmLabel: 'Hide review', danger: true,
    });
    expect(dialogOpen.mock.calls[0][1].data.message).toContain("Maria K.'s 2-star review of Harbour Loft");
    const patch = http.expectOne(`${ADMIN_REVIEWS_URL}1/`);
    expect(patch.request.body).toEqual({ is_hidden: true });
    patch.flush(review(1, { is_hidden: true }));
    expect(snack).toHaveBeenCalledWith('Review hidden from guests.', 'OK', expect.anything());
    listReq().flush(page([review(1, { is_hidden: true })]));
  });

  it('Show again on a hidden review; "Keep hidden" sends nothing', async () => {
    const cmp = await open();
    listReq().flush(page([review(1, { is_hidden: true })]));
    await settle();
    answer = false;
    cmp.toggleHidden(review(1, { is_hidden: true }));
    expect(dialogOpen.mock.calls[0][1].data).toMatchObject({ title: 'Show this review again?', confirmLabel: 'Show review' });
    http.expectNone(`${ADMIN_REVIEWS_URL}1/`);

    answer = true;
    cmp.toggleHidden(review(1, { is_hidden: true }));
    http.expectOne(`${ADMIN_REVIEWS_URL}1/`).flush(review(1));
    expect(snack).toHaveBeenCalledWith('Review shown again.', 'OK', expect.anything());
    listReq().flush(page([review(1)]));
  });

  it('a failed change shows the reason and refreshes', async () => {
    const cmp = await open();
    listReq().flush(page([review(1)]));
    await settle();
    cmp.toggleHidden(review(1));
    http.expectOne(`${ADMIN_REVIEWS_URL}1/`).flush({ detail: 'Only admin accounts can perform this action.' }, { status: 403, statusText: 'Forbidden' });
    expect(snack).toHaveBeenCalledWith('Only admin accounts can perform this action.', 'OK', expect.anything());
    listReq().flush(page([review(1)]));
  });

  it('error state with Try again; empty state without filters', async () => {
    await open();
    listReq().flush('boom', { status: 500, statusText: 'Server Error' });
    await settle();
    expect(text()).toContain("Couldn't load the reviews.");
    (el().querySelector('.message button') as HTMLButtonElement).click();
    listReq().flush(page([]));
    await settle();
    expect(text()).toContain('No reviews yet.');
  });
});
