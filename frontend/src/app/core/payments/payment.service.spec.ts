import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { BOOKINGS_URL } from '../bookings/booking.service';
import { PAYMENTS_URL, PaymentService } from './payment.service';

describe('PaymentService', () => {
  let service: PaymentService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(PaymentService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('loads the config once and shares it', () => {
    const seen: boolean[] = [];
    service.config().subscribe((c) => seen.push(c.enabled));
    http.expectOne(`${PAYMENTS_URL}config/`).flush({ enabled: true, hold_minutes: 30, currency: 'eur' });
    service.config().subscribe((c) => seen.push(c.enabled)); // cached: no second request
    expect(seen).toEqual([true, true]);
  });

  it('a failed config load counts as "off" and is retried next time', () => {
    let enabled: boolean | undefined;
    service.config().subscribe((c) => (enabled = c.enabled));
    http.expectOne(`${PAYMENTS_URL}config/`).flush(null, { status: 500, statusText: 'Server Error' });
    expect(enabled).toBe(false);
    service.config().subscribe();
    http.expectOne(`${PAYMENTS_URL}config/`).flush({ enabled: true, hold_minutes: 30, currency: 'eur' });
  });

  it('checkout POSTs to the booking and returns the Stripe page', () => {
    let url = '';
    service.checkout(77).subscribe((r) => (url = r.checkout_url));
    const req = http.expectOne(`${BOOKINGS_URL}77/checkout/`);
    expect(req.request.method).toBe('POST');
    req.flush({ checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_1', expires_at: '' });
    expect(url).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
  });
});
