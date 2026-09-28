import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { addDays, toIsoDate, todayLocal } from '../../core/dates';
import { PropertyDetail } from '../../core/properties/property.models';
import { FAVORITES_URL } from '../../core/favorites/favorite.service';
import { PROPERTIES_URL } from '../../core/properties/property.service';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { PropertyDetailPage } from './property-detail';

const day = (n: number) => toIsoDate(addDays(todayLocal(), n));

const detail = (overrides: Partial<PropertyDetail> = {}): PropertyDetail => ({
  id: 5, title: 'Harbour Loft', location: 'Chania, Greece', price_per_night: '91.00', capacity: 3,
  amenities: ['wifi', 'pool'], is_active: true, cover_image: null, rating_avg: 4.5, review_count: 2,
  description: 'Lovely.', images: [], created_at: '', updated_at: '',
  availability: { booked_ranges: [{ check_in: day(20), check_out: day(25) }] },
  ...overrides,
});

describe('PropertyDetailPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;

  async function open(url: string, loggedIn = false): Promise<PropertyDetailPage> {
    localStorage.clear();
    if (loggedIn) localStorage.setItem('bsd.user', JSON.stringify({ id: 1, email: 'g@example.com', role: 'guest' }));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'listings/:id', component: PropertyDetailPage }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    harness = await RouterTestingHarness.create();
    return harness.navigateByUrl(url, PropertyDetailPage);
  }

  const detailReq = () => http.expectOne((r) => r.url === `${PROPERTIES_URL}5/` && !r.params.has('check_in'));
  const availabilityReq = () => http.expectOne((r) => r.url === `${PROPERTIES_URL}5/` && r.params.has('check_in'));
  const text = () => (harness.routeNativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ').replace(/ /g, ' ');

  async function settle() {
    harness.detectChanges();
    await harness.fixture.whenStable();
  }

  it('loads the property, pre-fills the stay from the URL and confirms availability with the API', async () => {
    const page = await open(`/listings/5?check_in=${day(3)}&check_out=${day(8)}&guests=2`);
    detailReq().flush(detail());
    await settle();
    expect(text()).toContain('Harbour Loft');
    expect(text()).toContain('Wi-Fi');
    expect(page.guests()).toBe(2);

    const req = availabilityReq();
    expect(req.request.params.get('check_in')).toBe(day(3));
    req.flush(detail({ availability: { booked_ranges: [], is_available: true } }));
    await settle();
    expect(text()).toContain('Available for your dates');
    expect(text()).toContain('€91 × 5 nights');
    expect(text()).toContain('€455');
    expect(page.canBook()).toBe(true);
  });

  it('blocks dates that touch a booked night without asking the API', async () => {
    const page = await open(`/listings/5?check_in=${day(18)}&check_out=${day(21)}`);
    detailReq().flush(detail());
    await settle();
    expect(page.dateProblem()).toBe('Some of these nights are already booked.');
    expect(page.canBook()).toBe(false);
    http.expectNone((r) => r.params.has('check_in'));
  });

  it('checking out the day another guest arrives is fine', async () => {
    const page = await open(`/listings/5?check_in=${day(17)}&check_out=${day(20)}`);
    detailReq().flush(detail());
    await settle();
    expect(page.dateProblem()).toBeNull();
    availabilityReq().flush(detail({ availability: { booked_ranges: [], is_available: true } }));
  });

  it('shows when the API says the dates were taken meanwhile', async () => {
    const page = await open(`/listings/5?check_in=${day(3)}&check_out=${day(5)}`);
    detailReq().flush(detail());
    await settle();
    availabilityReq().flush(detail({ availability: { booked_ranges: [], is_available: false } }));
    await settle();
    expect(text()).toContain('Not available for these dates');
    expect(page.canBook()).toBe(false);
  });

  it('asks for a check-out date and caps stays at 30 nights', async () => {
    const page = await open('/listings/5');
    detailReq().flush(detail());
    await settle();
    page.onCalendar({ start: addDays(todayLocal(), 30), end: null });
    expect(page.dateProblem()).toBe('Pick a check-out date.');
    page.onCalendar({ start: addDays(todayLocal(), 30), end: addDays(todayLocal(), 61) });
    expect(page.dateProblem()).toBe('A stay can be at most 30 nights.');
  });

  it('Book now (logged out) goes to login, then back to the booking form with the stay', async () => {
    const page = await open(`/listings/5?check_in=${day(3)}&check_out=${day(5)}&guests=2`);
    detailReq().flush(detail());
    await settle();
    availabilityReq().flush(detail({ availability: { booked_ranges: [], is_available: true } }));
    await settle();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    page.bookNow();
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: `/booking/5?check_in=${day(3)}&check_out=${day(5)}&guests=2` },
    });
  });

  it('Book now (logged in) goes straight to the booking form', async () => {
    const page = await open(`/listings/5?check_in=${day(3)}&check_out=${day(5)}`, true);
    detailReq().flush(detail());
    await settle();
    availabilityReq().flush(detail({ availability: { booked_ranges: [], is_available: true } }));
    await settle();
    const go = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    page.bookNow();
    expect(router.serializeUrl(go.mock.calls[0][0] as never)).toBe(`/booking/5?check_in=${day(3)}&check_out=${day(5)}&guests=1`);
  });

  it('shows a Reviews section, and the header rating scrolls to it (TICKET-032)', async () => {
    const page = await open('/listings/5');
    detailReq().flush(detail());
    await settle();
    const reviewsReq = http.expectOne(`${PROPERTIES_URL}5/reviews/`);
    reviewsReq.flush({
      count: 1, next: null, previous: null,
      results: [{ id: 1, rating: 5, comment: 'Lovely view', author_name: 'Maria K.', created_at: '2026-09-20T10:00:00Z' }],
      summary: { rating_avg: 5, review_count: 1, breakdown: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: rating === 5 ? 1 : 0 })) },
    });
    await settle();
    expect(text()).toContain('Lovely view');

    const section = (harness.routeNativeElement as HTMLElement).querySelector('#reviews') as HTMLElement;
    const scroll = vi.fn();
    section.scrollIntoView = scroll;
    const link = (harness.routeNativeElement as HTMLElement).querySelector('.rating-link') as HTMLAnchorElement;
    expect(link.textContent).toContain('5.0 · 1 review'); // follows the reviews summary once it has loaded
    const url = router.url;
    link.click();
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(section);
    expect(router.url).toBe(url); // no navigation: the stay in the query params is kept
    expect(page).toBeTruthy();
  });

  describe('writing a review (TICKET-032)', () => {
    const reviewsPage = (avg: number | null, count: number) => ({
      count, next: null, previous: null, results: [],
      summary: { rating_avg: avg, review_count: count, breakdown: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: 0 })) },
    });
    const reviewsReq = () => http.expectOne(`${PROPERTIES_URL}5/reviews/`);
    const el = () => harness.routeNativeElement as HTMLElement;

    it('no button without permission from the server (anonymous / no stay)', async () => {
      await open('/listings/5');
      detailReq().flush(detail()); // no viewer_review at all
      await settle();
      expect(el().querySelector('.write-review')).toBeNull();
      expect(text()).not.toContain('You rated');
    });

    it('already reviewed: "You rated this place" with the stars, no button', async () => {
      await open('/listings/5', true);
      detailReq().flush(detail({ viewer_review: { can_review: false, my_review: { id: 3, rating: 4, comment: '', created_at: '' } } }));
      await settle();
      expect(text()).toContain('You rated this place');
      expect(el().querySelector('.my-review [aria-label="4 out of 5 stars"]')).toBeTruthy();
      expect(el().querySelector('.write-review')).toBeNull();
    });

    it('Write a review -> dialog -> posted: button becomes the rating, reviews and header reload', async () => {
      await open('/listings/5', true);
      const open_ = vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
        afterClosed: () => of({ id: 60, rating: 2, comment: 'Noisy', author_name: 'Maria K.', created_at: '' }),
      } as never);
      const snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockImplementation((() => undefined) as never);
      detailReq().flush(detail({ viewer_review: { can_review: true, my_review: null } }));
      await settle();
      reviewsReq().flush(reviewsPage(4.5, 2));
      await settle();

      (el().querySelector('.write-review') as HTMLButtonElement).click();
      expect(open_).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: { propertyId: 5, propertyTitle: 'Harbour Loft' } }));
      expect(snack).toHaveBeenCalledWith('Thanks - your review is posted.', 'OK', expect.anything());
      reviewsReq().flush(reviewsPage(3.7, 3));
      await settle();

      expect(el().querySelector('.write-review')).toBeNull();
      expect(text()).toContain('You rated this place');
      expect(el().querySelector('.rating-link')!.textContent).toContain('3.7 · 3 reviews');
    });
  });

  it('an inactive property (admin view) shows a banner and cannot be booked', async () => {
    const page = await open(`/listings/5?check_in=${day(3)}&check_out=${day(5)}`);
    detailReq().flush(detail({ is_active: false }));
    await settle();
    availabilityReq().flush(detail({ availability: { booked_ranges: [], is_available: true } }));
    await settle();
    expect(text()).toContain('Hidden from guests');
    expect(page.canBook()).toBe(false);
  });

  describe('the heart in the header (TICKET-033)', () => {
    const heart = () => (harness.routeNativeElement as HTMLElement).querySelector<HTMLButtonElement>('.head app-favorite-button button');

    it('shows Saved for a place the guest saved, and a tap removes it', async () => {
      await open('/listings/5', true);
      detailReq().flush(detail({ is_favorite: true }));
      await settle();
      expect(heart()!.getAttribute('aria-label')).toBe('Save Harbour Loft');
      expect(heart()!.getAttribute('aria-pressed')).toBe('true');
      expect(heart()!.textContent).toContain('Saved');
      heart()!.click();
      await settle();
      expect(heart()!.getAttribute('aria-pressed')).toBe('false');
      expect(heart()!.textContent).toContain('Save');
      const req = http.expectOne(`${FAVORITES_URL}5/`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
    });

    it('logged out: Save sends the visitor to log in, back to this page', async () => {
      await open('/listings/5');
      detailReq().flush(detail());
      await settle();
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      heart()!.click();
      await settle();
      http.expectNone(`${FAVORITES_URL}5/`);
      expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/listings/5', reason: 'favorite' } });
    });

    it('admins get no heart', async () => {
      localStorage.clear();
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: 'listings/:id', component: PropertyDetailPage }])],
      });
      localStorage.setItem('bsd.user', JSON.stringify({ id: 1, email: 'a@example.com', role: 'admin' }));
      http = TestBed.inject(HttpTestingController);
      harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/listings/5', PropertyDetailPage);
      detailReq().flush(detail());
      await settle();
      expect(heart()).toBeNull();
    });
  });

  it('404 shows a friendly not-found message', async () => {
    await open('/listings/5');
    detailReq().flush({ detail: 'Not found.' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(text()).toContain("This stay doesn't exist or is no longer available.");
  });

  describe('bottom bar on tablets and phones (TICKET-031)', () => {
    const bar = () => (harness.routeNativeElement as HTMLElement).querySelector<HTMLElement>('.mobile-bar');
    const barButton = () => bar()!.querySelector('button')!;

    afterEach(() => vi.unstubAllGlobals());

    it('offers Choose dates, which brings the booking panel into view', async () => {
      await open('/listings/5');
      detailReq().flush(detail());
      await settle();
      expect(bar()!.textContent).toContain('€91');
      expect(barButton().textContent).toContain('Choose dates');

      const panel = (harness.routeNativeElement as HTMLElement).querySelector<HTMLElement>('.panel')!;
      panel.scrollIntoView = vi.fn();
      barButton().click();
      expect(panel.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
      expect(document.activeElement).toBe(panel);
    });

    it('turns into Book now with the stay total once the dates are confirmed', async () => {
      const page = await open(`/listings/5?check_in=${day(3)}&check_out=${day(8)}`, true);
      detailReq().flush(detail());
      await settle();
      availabilityReq().flush(detail({ availability: { booked_ranges: [], is_available: true } }));
      await settle();
      expect(bar()!.textContent).toContain('€455 total');
      expect(barButton().textContent).toContain('Book now');

      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      barButton().click();
      expect(page.canBook()).toBe(true);
      expect(navigate).toHaveBeenCalled();
    });

    it('hides while the booking panel itself is on screen', async () => {
      let report: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
      const disconnect = vi.fn();
      vi.stubGlobal('IntersectionObserver', class {
        constructor(cb: (entries: { isIntersecting: boolean }[]) => void) { report = cb; }
        observe() {}
        disconnect = disconnect;
      });
      await open('/listings/5');
      detailReq().flush(detail());
      await settle();
      expect(bar()).not.toBeNull();

      report!([{ isIntersecting: true }]);
      await settle();
      expect(bar()).toBeNull();

      report!([{ isIntersecting: false }]);
      await settle();
      expect(bar()).not.toBeNull();

      harness.fixture.destroy();
      expect(disconnect).toHaveBeenCalled();
    });
  });
});
