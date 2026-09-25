import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { Booking } from '../../core/bookings/booking.models';
import { BOOKINGS_URL } from '../../core/bookings/booking.service';
import { addDays, toIsoDate, todayLocal } from '../../core/dates';
import { PropertyDetail } from '../../core/properties/property.models';
import { PROPERTIES_URL } from '../../core/properties/property.service';
import { BookingFormPage } from './booking';

const day = (n: number) => toIsoDate(addDays(todayLocal(), n));

const property = (overrides: Partial<PropertyDetail> = {}): PropertyDetail => ({
  id: 5, title: 'Harbour Loft', location: 'Chania, Greece', price_per_night: '91.00', capacity: 3,
  amenities: [], is_active: true, cover_image: null, rating_avg: null, review_count: 0,
  description: '', images: [], created_at: '', updated_at: '',
  availability: { booked_ranges: [] },
  ...overrides,
});

const created: Booking = {
  id: 77, property: { id: 5, title: 'Harbour Loft', location: 'Chania, Greece', price_per_night: '91.00', cover_image: null },
  check_in: day(10), check_out: day(12), nights: 2, guests: 2, total_price: '182.00', status: 'pending',
  can_cancel: true, cancel_deadline: `${day(8)}T15:00:00+02:00`, guest_email: null, created_at: '',
};

describe('BookingFormPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;

  async function open(url: string): Promise<BookingFormPage> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'booking/:propertyId', component: BookingFormPage }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    return harness.navigateByUrl(url, BookingFormPage);
  }

  const propertyReq = () => http.expectOne((r) => r.url === `${PROPERTIES_URL}5/` && !r.params.has('check_in'));
  const availabilityReq = () => http.expectOne((r) => r.url === `${PROPERTIES_URL}5/` && r.params.has('check_in'));
  const text = () => (harness.routeNativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ').replace(/ /g, ' ');
  async function settle() {
    harness.detectChanges();
    await harness.fixture.whenStable();
  }

  /** Open with a stay from the URL and let the API confirm it's free. */
  async function ready(): Promise<BookingFormPage> {
    const page = await open(`/booking/5?check_in=${day(10)}&check_out=${day(12)}&guests=2`);
    propertyReq().flush(property());
    await settle();
    availabilityReq().flush(property({ availability: { booked_ranges: [], is_available: true } }));
    await settle();
    return page;
  }

  it('pre-fills the stay, shows the live price, and unlocks step 2 once the API confirms', async () => {
    const page = await ready();
    expect(page.guests()).toBe(2);
    expect(page.tripReady()).toBe(true);
    expect(text()).toContain('Available for your dates');
    expect(text()).toContain('€91 × 2 nights');
    expect(text()).toContain('€182');
    expect(page.deadline()?.passed).toBe(false);
  });

  it('Confirm sends exactly one POST (double clicks ignored) and shows the confirmation', async () => {
    const page = await ready();
    page.confirm();
    page.confirm(); // double click while in flight
    const post = http.expectOne(BOOKINGS_URL);
    expect(post.request.body).toEqual({ property: 5, check_in: day(10), check_out: day(12), guests: 2 });
    expect(page.submitting()).toBe(true);
    post.flush(created, { status: 201, statusText: 'Created' });
    await settle();
    expect(page.booking()?.id).toBe(77);
    expect(text()).toContain('Booking request sent');
    expect(text()).toContain('#77');
    expect(text()).toContain('Pending');
    expect(text()).toContain('€182');
    expect(text()).toContain('Free cancellation until');
  });

  it('409: explains, reloads the booked nights, and blocks the now-taken dates', async () => {
    const page = await ready();
    page.confirm();
    http.expectOne(BOOKINGS_URL).flush(
      { detail: 'These dates were just booked by someone else. Please pick different dates.', code: 'dates_unavailable' },
      { status: 409, statusText: 'Conflict' },
    );
    propertyReq().flush(property({ availability: { booked_ranges: [{ check_in: day(9), check_out: day(11) }] } }));
    await settle();
    expect(page.submitError()).toContain('just booked by someone else');
    expect(page.dateProblem()).toBe('Some of these nights are already booked.');
    expect(page.tripReady()).toBe(false);
    expect(page.booking()).toBeNull();
  });

  it('400: shows the server message in plain words', async () => {
    const page = await ready();
    page.confirm();
    http.expectOne(BOOKINGS_URL).flush({ guests: ['This property sleeps at most 3 guests.'] }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(page.submitError()).toBe('This property sleeps at most 3 guests.');
  });

  it('cannot continue without confirmed dates', async () => {
    const page = await open('/booking/5');
    propertyReq().flush(property());
    await settle();
    expect(page.tripReady()).toBe(false);
    expect(text()).toContain('Pick your dates to see the price.');
    page.confirm();
    http.expectNone(BOOKINGS_URL);
  });

  it('an inactive or missing property cannot be booked', async () => {
    await open('/booking/5');
    propertyReq().flush(property({ is_active: false }));
    await settle();
    expect(text()).toContain("This stay can't be booked");
  });

  it('404 too', async () => {
    await open('/booking/5');
    propertyReq().flush({ detail: 'Not found.' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(text()).toContain("This stay can't be booked");
  });

  it('a bad property id goes back to the listings', async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'booking/:propertyId', component: BookingFormPage },
          { path: 'listings', children: [] },
        ]),
      ],
    });
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/booking/abc');
    await h.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/listings');
  });
});
