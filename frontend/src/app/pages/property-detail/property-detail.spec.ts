import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { addDays, toIsoDate, todayLocal } from '../../core/dates';
import { PropertyDetail } from '../../core/properties/property.models';
import { PROPERTIES_URL } from '../../core/properties/property.service';
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

  it('an inactive property (admin view) shows a banner and cannot be booked', async () => {
    const page = await open(`/listings/5?check_in=${day(3)}&check_out=${day(5)}`);
    detailReq().flush(detail({ is_active: false }));
    await settle();
    availabilityReq().flush(detail({ availability: { booked_ranges: [], is_available: true } }));
    await settle();
    expect(text()).toContain('Hidden from guests');
    expect(page.canBook()).toBe(false);
  });

  it('404 shows a friendly not-found message', async () => {
    await open('/listings/5');
    detailReq().flush({ detail: 'Not found.' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(text()).toContain("This stay doesn't exist or is no longer available.");
  });
});
