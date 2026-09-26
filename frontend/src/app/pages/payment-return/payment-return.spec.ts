import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';

import { Booking } from '../../core/bookings/booking.models';
import { BOOKINGS_URL } from '../../core/bookings/booking.service';
import { addDays, toIsoDate, todayLocal } from '../../core/dates';
import { BrowserRedirect } from '../../core/payments/browser-redirect';
import { PaymentStatus } from '../../core/payments/payment.models';
import { POLL_EVERY_MS, POLL_TIMES, PaymentReturnPage, phaseFor } from './payment-return';

const day = (n: number) => toIsoDate(addDays(todayLocal(), n));
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

function booking(status: Booking['status'], pay: PaymentStatus | null, extra: Partial<NonNullable<Booking['payment']>> = {}): Booking {
  return {
    id: 77,
    property: { id: 5, title: 'Harbour Loft', location: 'Chania, Greece', price_per_night: '91.00', cover_image: null },
    check_in: day(10), check_out: day(12), nights: 2, guests: 2, total_price: '182.00', status,
    can_cancel: status !== 'cancelled', cancel_deadline: `${day(8)}T15:00:00+02:00`, guest_email: null, created_at: '',
    payment: pay && {
      status: pay, amount: '182.00', currency: 'eur', expires_at: inMinutes(24), paid_at: null,
      can_pay: pay === 'open' && status === 'pending', ...extra,
    },
  };
}

describe('phaseFor (what the return page shows)', () => {
  it('covers every booking/payment combination', () => {
    expect(phaseFor(booking('pending', 'open'), true)).toBe('confirming');
    expect(phaseFor(booking('pending', 'open'), false)).toBe('unpaid');
    expect(phaseFor(booking('pending', 'open', { expires_at: inMinutes(-1) }), false)).toBe('timed_out');
    expect(phaseFor(booking('confirmed', 'paid'), true)).toBe('confirmed');
    expect(phaseFor(booking('confirmed', 'cancelled'), false)).toBe('confirmed'); // confirmed by the host
    expect(phaseFor(booking('pending', 'processing'), true)).toBe('processing');
    expect(phaseFor(booking('cancelled', 'expired'), true)).toBe('released');
    expect(phaseFor(booking('cancelled', 'failed'), true)).toBe('released');
    expect(phaseFor(booking('cancelled', 'cancelled'), false)).toBe('cancelled');
    expect(phaseFor(booking('cancelled', 'paid'), false)).toBe('cancelled');
  });
});

describe('PaymentReturnPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let redirectTo: ReturnType<typeof vi.fn>;

  const getReq = () => http.expectOne((r) => r.url === `${BOOKINGS_URL}77/` && r.method === 'GET');
  const text = () => (harness.routeNativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
  async function settle() {
    harness.detectChanges();
    await harness.fixture.whenStable();
  }

  async function open(query: string): Promise<PaymentReturnPage> {
    redirectTo = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'bookings/:id/payment', component: PaymentReturnPage },
          { path: 'my-bookings', children: [] },
        ]),
        { provide: BrowserRedirect, useValue: { to: redirectTo } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockImplementation(() => ({ afterClosed: () => of(true) }) as never);
    harness = await RouterTestingHarness.create();
    return harness.navigateByUrl(`/bookings/77/payment${query}`, PaymentReturnPage);
  }

  afterEach(() => vi.useRealTimers());

  it('after paying: "Confirming…" until the webhook has confirmed it, then the confirmation', async () => {
    const page = await open('?session_id=cs_test_1');
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    getReq().flush(booking('pending', 'open'));
    await settle();
    expect(page.view()).toBe('confirming');
    expect(text()).toContain('Confirming your payment');

    vi.advanceTimersByTime(POLL_EVERY_MS);
    getReq().flush(booking('pending', 'open')); // webhook not there yet
    vi.advanceTimersByTime(POLL_EVERY_MS);
    getReq().flush(booking('confirmed', 'paid'));
    await settle();
    expect(page.view()).toBe('confirmed');
    expect(text()).toContain("Payment received - you're booked!");
    expect(text()).toContain('#77');
    expect(text()).toContain('Paid');
    expect(text()).toContain('full refund');
  });

  it('after paying: no confirmation within 30 s -> "Waiting for confirmation"', async () => {
    const page = await open('?session_id=cs_test_1');
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    getReq().flush(booking('pending', 'open'));
    for (let i = 0; i < POLL_TIMES; i++) {
      vi.advanceTimersByTime(POLL_EVERY_MS);
      getReq().flush(booking('pending', 'open'));
    }
    await settle();
    expect(page.view()).toBe('not_yet');
    expect(text()).toContain("Stripe hasn't confirmed your payment to us yet");
    vi.advanceTimersByTime(POLL_EVERY_MS * 3);
    http.expectNone((r) => r.url === `${BOOKINGS_URL}77/`); // stopped polling
  });

  it('a delayed payment (e.g. SEPA) shows "being processed"', async () => {
    const page = await open('?session_id=cs_test_1');
    getReq().flush(booking('pending', 'processing'));
    await settle();
    expect(page.view()).toBe('processing');
    expect(text()).toContain('Your payment is being processed');
  });

  it('backed out of Stripe: live countdown, Pay now goes back to Stripe', async () => {
    const page = await open('?cancelled=1');
    getReq().flush(booking('pending', 'open'));
    await settle();
    expect(page.view()).toBe('unpaid');
    expect(text()).toContain('Payment not completed');
    expect(text()).toMatch(/Your dates are held for 2[34]:\d\d/);
    expect(text()).toContain('Pay now €182');

    page.payNow();
    page.payNow(); // double click
    const checkout = http.expectOne(`${BOOKINGS_URL}77/checkout/`);
    checkout.flush({ checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_1', expires_at: '' });
    expect(redirectTo).toHaveBeenCalledExactlyOnceWith('https://checkout.stripe.com/c/pay/cs_test_1');
  });

  it('the countdown reaching zero turns into "Time ran out" (no Pay now)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'Date'] }); // before the page's clock starts
    const page = await open('?cancelled=1');
    getReq().flush(booking('pending', 'open', { expires_at: inMinutes(0.05) })); // 3 s left
    await settle();
    expect(page.view()).toBe('unpaid');
    vi.advanceTimersByTime(4000);
    await settle();
    expect(page.view()).toBe('timed_out');
    expect(text()).toContain('Time ran out');
    expect(text()).not.toContain('Pay now');
    expect(text()).toContain('Book again');
  });

  it('Pay now refused (e.g. the time just ran out): shows why and reloads', async () => {
    const page = await open('?cancelled=1');
    getReq().flush(booking('pending', 'open'));
    page.payNow();
    http.expectOne(`${BOOKINGS_URL}77/checkout/`).flush(
      { detail: 'The time to pay for this booking has run out, so the dates were released. Please book again.', code: 'payment_window_closed' },
      { status: 409, statusText: 'Conflict' },
    );
    getReq().flush(booking('cancelled', 'expired'));
    await settle();
    expect(page.actionError()).toContain('has run out');
    expect(page.view()).toBe('released');
    expect(redirectTo).not.toHaveBeenCalled();
  });

  it('Cancel booking (after the dialog) cancels and shows it', async () => {
    const page = await open('?cancelled=1');
    getReq().flush(booking('pending', 'open'));
    page.cancelBooking();
    const patch = http.expectOne(`${BOOKINGS_URL}77/`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ status: 'cancelled' });
    patch.flush(booking('cancelled', 'cancelled'));
    await settle();
    expect(page.view()).toBe('cancelled');
    expect(text()).toContain("You weren't charged");
  });

  it('released and cancelled-after-paying states explain what happened', async () => {
    let page = await open('');
    getReq().flush(booking('cancelled', 'failed'));
    await settle();
    expect(text()).toContain('Payment failed');
    expect(text()).toContain("You weren't charged");

    TestBed.resetTestingModule();
    page = await open('');
    getReq().flush(booking('cancelled', 'paid'));
    await settle();
    expect(page.view()).toBe('cancelled');
    expect(text()).toContain('full refund of €182');
  });

  it("a booking without online payment goes to My bookings; unknown ones say so", async () => {
    await open('');
    getReq().flush({ ...booking('pending', null), payment: null });
    await settle();
    expect(TestBed.inject(Router).url).toBe('/my-bookings');

    TestBed.resetTestingModule();
    const page = await open('');
    getReq().flush({ detail: 'Not found.' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(page.view()).toBe('not_found');
    expect(text()).toContain("couldn't find this booking");
  });
});
