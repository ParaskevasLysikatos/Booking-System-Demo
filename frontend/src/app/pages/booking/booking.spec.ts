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

// ---------------------------------------------------------------------------
// TICKET-029: Confirm and pay
// ---------------------------------------------------------------------------

import { BrowserRedirect } from '../../core/payments/browser-redirect';
import { PAYMENTS_URL } from '../../core/payments/payment.service';

describe('BookingFormPage with online payments', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let redirectTo: ReturnType<typeof vi.fn>;

  const holdEnds = new Date(Date.now() + 31 * 60_000).toISOString();
  const createdAwaitingPayment: Booking = {
    ...created,
    payment: { status: 'open', amount: '182.00', currency: 'eur', expires_at: holdEnds, paid_at: null, can_pay: true },
  };

  const text = () => (harness.routeNativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
  async function settle() {
    harness.detectChanges();
    await harness.fixture.whenStable();
  }

  async function ready(enabled = true): Promise<BookingFormPage> {
    localStorage.clear();
    redirectTo = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'booking/:propertyId', component: BookingFormPage }]),
        { provide: BrowserRedirect, useValue: { to: redirectTo } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl(`/booking/5?check_in=${day(10)}&check_out=${day(12)}&guests=2`, BookingFormPage);
    http.expectOne(`${PAYMENTS_URL}config/`).flush({ enabled, hold_minutes: 30, currency: 'eur' });
    http.expectOne((r) => r.url === `${PROPERTIES_URL}5/` && !r.params.has('check_in')).flush(property());
    await settle();
    http.expectOne((r) => r.url === `${PROPERTIES_URL}5/` && r.params.has('check_in'))
      .flush(property({ availability: { booked_ranges: [], is_available: true } }));
    await settle();
    return page;
  }

  const checkoutUrl = `${BOOKINGS_URL}77/checkout/`;

  it('step 2 says what will happen: pay on Stripe, dates held 30 minutes, full refund policy', async () => {
    const page = await ready();
    page.stepper()!.next();
    await settle();
    expect(page.paymentsOn()).toBe(true);
    expect(text()).toContain('Confirm and pay');
    expect(text()).toContain("You'll pay €182 securely on Stripe's payment page");
    expect(text()).toContain('held for about 30 minutes');
    expect(text()).toContain('full refund');
    expect(text()).not.toContain("You won't be charged now");
  });

  it('Confirm and pay: one booking, then the Stripe page, then the browser leaves', async () => {
    const page = await ready();
    page.confirm();
    http.expectOne(BOOKINGS_URL).flush(createdAwaitingPayment, { status: 201, statusText: 'Created' });
    await settle();
    expect(page.redirecting()).toBe(true);
    expect(text()).toContain('Taking you to secure payment');
    const checkout = http.expectOne(checkoutUrl);
    expect(checkout.request.method).toBe('POST');
    checkout.flush({ checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_1', expires_at: holdEnds });
    expect(redirectTo).toHaveBeenCalledExactlyOnceWith('https://checkout.stripe.com/c/pay/cs_test_1');
  });

  it("if the payment page can't be opened, Try again reuses the SAME booking", async () => {
    const page = await ready();
    page.confirm();
    http.expectOne(BOOKINGS_URL).flush(createdAwaitingPayment, { status: 201, statusText: 'Created' });
    http.expectOne(checkoutUrl).flush(
      { detail: "We couldn't reach the payment provider. Please try again.", code: 'payment_provider_error' },
      { status: 502, statusText: 'Bad Gateway' },
    );
    await settle();
    expect(page.checkoutError()).toContain("couldn't reach the payment provider");
    expect(text()).toContain('Your dates are held - payment not started');
    expect(text()).toContain('#77');

    page.confirm(); // same as clicking Try again
    http.expectNone(BOOKINGS_URL); // no second booking
    http.expectOne(checkoutUrl).flush({ checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_1', expires_at: holdEnds });
    expect(redirectTo).toHaveBeenCalledOnce();
  });

  it('a double click while opening the payment page sends one request', async () => {
    const page = await ready();
    page.confirm();
    http.expectOne(BOOKINGS_URL).flush(createdAwaitingPayment, { status: 201, statusText: 'Created' });
    page.goToPayment(createdAwaitingPayment);
    page.goToPayment(createdAwaitingPayment);
    expect(http.match(checkoutUrl).length).toBe(1);
  });

  it('a booking without online payment still gets the classic confirmation screen', async () => {
    const page = await ready(false);
    page.confirm();
    http.expectOne(BOOKINGS_URL).flush({ ...created, payment: null }, { status: 201, statusText: 'Created' });
    await settle();
    expect(text()).toContain('Booking request sent');
    expect(text()).toContain("You haven't been charged");
    http.expectNone(checkoutUrl);
    expect(redirectTo).not.toHaveBeenCalled();
  });
});
