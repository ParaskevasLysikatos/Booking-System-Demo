import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, convertToParamMap, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';

import { Booking } from '../../../core/bookings/booking.models';
import { BOOKINGS_URL } from '../../../core/bookings/booking.service';
import { ALL_BLOCKS_URL } from '../../../core/admin/closed-dates.service';
import { addDays, toIsoDate, todayLocal } from '../../../core/dates';
import { PROPERTIES_URL } from '../../../core/properties/property.service';
import { AdminBookingsPage, parseAdminBookingsQuery, toApiQuery } from './admin-bookings';
import { TranslationService } from '../../../core/i18n/translation.service';

const day = (n: number) => toIsoDate(addDays(todayLocal(), n));
const booking = (id: number, overrides: Partial<Booking> = {}): Booking => ({
  id, property: { id: 5, title: 'Harbour Loft', location: 'Chania', price_per_night: '91.00', cover_image: null },
  check_in: day(10), check_out: day(12), nights: 2, guests: 2, total_price: '182.00', status: 'pending',
  can_cancel: true, cancel_deadline: '', guest_email: 'sara@example.com', created_at: new Date().toISOString(), ...overrides,
});
const page = (results: Booking[], count = results.length) => ({ count, next: null, previous: null, results });

describe('admin bookings query', () => {
  it('parses the URL and maps tabs/filters to the API (everyone, never mine=true)', () => {
    const q = parseAdminBookingsQuery(convertToParamMap({ tab: 'past', search: ' sara ', property: '7', pending: '1', page: '2' }));
    expect(q).toEqual({ tab: 'past', search: 'sara', property: 7, pendingOnly: true, page: 2 });
    expect(toApiQuery(q)).toEqual({ when: 'past', statuses: ['pending'], search: 'sara', property: 7, page: 2 });
    expect(toApiQuery(parseAdminBookingsQuery(convertToParamMap({})))).toEqual({
      when: 'upcoming', statuses: ['pending', 'confirmed'], search: undefined, property: undefined, page: 1,
    });
    // cancelled tab: any date, and "pending only" doesn't apply
    const cancelled = parseAdminBookingsQuery(convertToParamMap({ tab: 'cancelled', pending: '1' }));
    expect(cancelled.pendingOnly).toBe(false);
    expect(toApiQuery(cancelled)).toMatchObject({ when: undefined, statuses: ['cancelled'] });
  });
});

describe('AdminBookingsPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;
  let answer: boolean;
  let snack: ReturnType<typeof vi.fn>;

  async function open(url = '/admin/bookings') {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: 'admin/bookings', component: AdminBookingsPage }])],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    answer = true;
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockImplementation(() => ({ afterClosed: () => of(answer) }) as never);
    snack = vi.fn();
    vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockImplementation(snack as never);
    harness = await RouterTestingHarness.create();
    const cmp = await harness.navigateByUrl(url, AdminBookingsPage);
    http.expectOne((r) => r.url === PROPERTIES_URL).flush({ count: 1, next: null, previous: null, results: [{ id: 5, title: 'Harbour Loft', is_active: true }] });
    return cmp;
  }

  const listReq = (): TestRequest => http.expectOne((r) => r.url === BOOKINGS_URL && r.method === 'GET' && !r.params.has('page_size'));
  const badgeReq = (): TestRequest => http.expectOne((r) => r.url === BOOKINGS_URL && r.params.get('page_size') === '1');
  const text = () => (harness.routeNativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');

  afterEach(() => http.verify());

  it("asks for everyone's upcoming, non-cancelled bookings by default", async () => {
    await open();
    listReq().flush(page([]));
  });

  it('renders rows and actions', async () => {
    await open();
    listReq().flush(page([booking(1), booking(2, { status: 'confirmed', guest_email: 'nikos@example.com' })]));
    harness.detectChanges();
    expect(text()).toContain('sara@example.com');
    expect(text()).toContain('nikos@example.com');
    expect(text()).toContain('Pending');
    expect(harness.routeNativeElement!.querySelectorAll('button.confirm').length).toBe(1);
    expect(harness.routeNativeElement!.querySelectorAll('button.cancel').length).toBe(2);
  });

  it('tabs, pending-only and property go through the URL', async () => {
    const cmp = await open();
    listReq().flush(page([]));
    cmp.selectTab(1);
    await harness.fixture.whenStable();
    expect(router.url).toBe('/admin/bookings?tab=past');
    listReq().flush(page([]));
    cmp.setPendingOnly(true);
    await harness.fixture.whenStable();
    expect(router.url).toBe('/admin/bookings?tab=past&pending=1');
    expect(listReq().request.params.toString()).toBe('when=past&status=pending');
    cmp.setProperty(5);
    await harness.fixture.whenStable();
    expect(listReq().request.params.get('property')).toBe('5');
  });

  it('Closed dates tab (TICKET-045): no bookings request, only the Property filter, the list follows it', async () => {
    const cmp = await open('/admin/bookings?tab=closed&pending=1&search=x');
    expect(cmp.query()).toMatchObject({ tab: 'closed', pendingOnly: false });
    http.expectNone((r) => r.url === BOOKINGS_URL);
    http.expectOne((r) => r.url === ALL_BLOCKS_URL && !r.params.has('property')).flush([]);
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('.search')).toBeNull();
    expect(el.querySelector('mat-slide-toggle')).toBeNull();
    expect(el.querySelector('.prop')).not.toBeNull();
    expect(text()).toContain('No closed dates coming up.');
    cmp.setProperty(5);
    await harness.fixture.whenStable();
    expect(router.url).toBe('/admin/bookings?tab=closed&search=x&property=5');
    http.expectOne((r) => r.url === ALL_BLOCKS_URL && r.params.get('property') === '5').flush([]);
    cmp.selectTab(0);
    await harness.fixture.whenStable();
    listReq().flush(page([]));
  });

  it('confirm: dialog -> PATCH confirmed -> snackbar, list + badge refreshed', async () => {
    const cmp = await open();
    listReq().flush(page([booking(54)]));
    cmp.confirmBooking(booking(54));
    const patch = http.expectOne({ url: `${BOOKINGS_URL}54/`, method: 'PATCH' });
    expect(patch.request.body).toEqual({ status: 'confirmed' });
    patch.flush(booking(54, { status: 'confirmed' }));
    expect(snack.mock.calls[0][0]).toBe('Booking #54 confirmed.');
    listReq().flush(page([booking(54, { status: 'confirmed' })]));
    badgeReq().flush(page([], 6));
  });

  it('cancel: danger dialog -> PATCH cancelled; declining sends nothing', async () => {
    const cmp = await open();
    listReq().flush(page([booking(54)]));
    answer = false;
    cmp.cancelBooking(booking(54));
    http.expectNone({ url: `${BOOKINGS_URL}54/`, method: 'PATCH' });
    answer = true;
    cmp.cancelBooking(booking(54));
    const patch = http.expectOne({ url: `${BOOKINGS_URL}54/`, method: 'PATCH' });
    expect(patch.request.body).toEqual({ status: 'cancelled' });
    patch.flush(booking(54, { status: 'cancelled' }));
    expect(snack.mock.calls[0][0]).toBe('Booking #54 cancelled.');
    listReq().flush(page([]));
    badgeReq().flush(page([], 5));
  });

  it('server refusal (changed meanwhile) shows its reason and refreshes', async () => {
    const cmp = await open();
    listReq().flush(page([booking(54)]));
    cmp.confirmBooking(booking(54));
    http.expectOne({ url: `${BOOKINGS_URL}54/`, method: 'PATCH' }).flush(
      { status: ["Can't change a cancelled booking to confirmed."] },
      { status: 400, statusText: 'Bad Request' },
    );
    expect(snack.mock.calls[0][0]).toBe("Can't change a cancelled booking to confirmed.");
    listReq().flush(page([booking(54, { status: 'cancelled' })]));
    badgeReq().flush(page([], 4));
  });

  it('empty and error states', async () => {
    const cmp = await open();
    listReq().flush({}, { status: 500, statusText: 'Server Error' });
    harness.detectChanges();
    expect(text()).toContain("Couldn't load the bookings.");
    cmp.retry();
    listReq().flush(page([]));
    harness.detectChanges();
    expect(text()).toContain('No bookings match.');
  });

  // --- TICKET-029: online payments --------------------------------------

  const paid = (id: number, status: Booking['status'], pay: NonNullable<Booking['payment']>['status']) =>
    booking(id, {
      status,
      payment: { status: pay, amount: '182.00', currency: 'eur', expires_at: new Date(2030, 0, 1, 14, 32).toISOString(), paid_at: null, can_pay: false },
    });
  const dialogMessage = () => {
    const calls = vi.mocked(TestBed.inject(MatDialog).open).mock.calls;
    return (calls[calls.length - 1][1] as { data: { message: string } }).data.message;
  };

  it('Payment column: one chip per state, refund due, and a dash for bookings without online payment', async () => {
    await open();
    listReq().flush(page([
      paid(1, 'confirmed', 'paid'),
      paid(2, 'pending', 'open'),
      paid(3, 'pending', 'processing'),
      paid(4, 'confirmed', 'cancelled'),
      paid(5, 'cancelled', 'paid'),
      booking(6),
    ]));
    harness.detectChanges();
    const chips = [...harness.routeNativeElement!.querySelectorAll('.chip.pay')].map((c) => c.textContent!.trim());
    expect(chips).toEqual(['Paid', 'Awaiting payment', 'Processing', 'Waived', 'Refund due']);
    expect(text()).toContain('Awaiting payment until 14:32');
    expect(text()).toContain('—');
  });

  it('confirming an unpaid booking warns that the payment is waived', async () => {
    const cmp = await open();
    listReq().flush(page([paid(54, 'pending', 'open')]));
    answer = false;
    cmp.confirmBooking(paid(54, 'pending', 'open'));
    expect(dialogMessage()).toContain("hasn't paid online yet");
    expect(dialogMessage()).toContain('payment is waived');
    cmp.confirmBooking(booking(55)); // no online payment: no warning
    expect(dialogMessage()).not.toContain('waived');
  });

  it('cancel dialog says what happens to the money', async () => {
    const cmp = await open();
    listReq().flush(page([]));
    answer = false;
    cmp.cancelBooking(paid(1, 'confirmed', 'paid'));
    expect(dialogMessage()).toContain("refunded in full to their card automatically");
    cmp.cancelBooking(paid(2, 'pending', 'open'));
    expect(dialogMessage()).toContain('payment page will be closed first');
    cmp.cancelBooking(booking(3));
    expect(dialogMessage()).toContain('nothing to refund');
  });

  it('a server "payment just went through" refusal is shown and the list refreshed', async () => {
    const cmp = await open();
    listReq().flush(page([paid(54, 'pending', 'open')]));
    cmp.cancelBooking(paid(54, 'pending', 'open'));
    http.expectOne({ url: `${BOOKINGS_URL}54/`, method: 'PATCH' }).flush(
      { detail: "The payment for this booking has just gone through, so it's now confirmed. Please refresh.", code: 'payment_completed' },
      { status: 409, statusText: 'Conflict' },
    );
    expect(snack.mock.calls[0][0]).toContain('just gone through');
    listReq().flush(page([paid(54, 'confirmed', 'paid')]));
    badgeReq().flush(page([], 0));
  });

  // --- TICKET-040: refunds ------------------------------------------------

  const refunded = (id: number, refund: NonNullable<NonNullable<Booking['payment']>['refund']>, extra: Partial<NonNullable<Booking['payment']>> = {}) => {
    const x = paid(id, 'cancelled', 'paid');
    x.payment = { ...x.payment!, refund, ...extra };
    return x;
  };
  const pendingRefund = { status: 'pending' as const, amount: '182.00', requested_at: '2030-01-01T10:00:00Z', refunded_at: null, failure_reason: null };
  const failedRefund = { ...pendingRefund, status: 'failed' as const, failure_reason: "The Stripe key isn't allowed to create refunds" };

  it('refund chips, the failure reason / refund date, and Refund now only where offered', async () => {
    await open('/admin/bookings?tab=cancelled');
    listReq().flush(page([
      refunded(1, pendingRefund),
      refunded(2, { ...pendingRefund, status: 'refunded', refunded_at: '2026-09-27T10:00:00Z' }),
      refunded(3, failedRefund, { can_refund: true }),
      { ...paid(4, 'cancelled', 'paid'), payment: { ...paid(4, 'cancelled', 'paid').payment!, can_refund: true } }, // cancelled before refunds existed
    ]));
    harness.detectChanges();
    const el = harness.routeNativeElement!;
    const chips = [...el.querySelectorAll('.chip.pay')].map((c) => c.textContent!.trim());
    expect(chips).toEqual(['Refund pending', 'Refunded', 'Refund failed', 'Refund due']);
    expect(text()).toMatch(/€182 on 27 Sept? 2026/);
    expect(text()).toContain("The Stripe key isn't allowed to create refunds");
    const buttons = [...el.querySelectorAll('button.refund')];
    expect(buttons.length).toBe(2);
    expect(buttons.every((btn) => btn.textContent!.includes('Refund now'))).toBe(true);
  });

  it('Refund now: dialog (with the last failure) -> POST -> snackbar, list + badge refreshed', async () => {
    const cmp = await open('/admin/bookings?tab=cancelled');
    const row = refunded(38, failedRefund, { can_refund: true });
    listReq().flush(page([row]));
    answer = false;
    cmp.refundNow(row);
    expect(dialogMessage()).toContain('refund the full €182');
    expect(dialogMessage()).toContain('never be refunded twice');
    expect(dialogMessage()).toContain("The last attempt failed: The Stripe key isn't allowed");
    http.expectNone({ url: `${BOOKINGS_URL}38/refund/`, method: 'POST' });
    answer = true;
    cmp.refundNow(row);
    const post = http.expectOne({ url: `${BOOKINGS_URL}38/refund/`, method: 'POST' });
    post.flush(refunded(38, pendingRefund));
    expect(snack.mock.calls[0][0]).toBe('Refund of €182 for booking #38 sent to Stripe.');
    listReq().flush(page([]));
    badgeReq().flush(page([], 0));
  });

  it('Refund now failing again shows the new reason', async () => {
    const cmp = await open('/admin/bookings?tab=cancelled');
    const row = refunded(38, failedRefund, { can_refund: true });
    listReq().flush(page([row]));
    cmp.refundNow(row);
    http.expectOne({ url: `${BOOKINGS_URL}38/refund/`, method: 'POST' })
      .flush(refunded(38, { ...failedRefund, failure_reason: "Couldn't reach Stripe." }, { can_refund: true }));
    expect(snack.mock.calls[0][0]).toBe("The refund for booking #38 failed: Couldn't reach Stripe."); // one full stop
    listReq().flush(page([]));
    badgeReq().flush(page([], 0));
  });

  it('Refund now refused by the server (e.g. already refunded) shows why', async () => {
    const cmp = await open('/admin/bookings?tab=cancelled');
    const row = refunded(38, failedRefund, { can_refund: true });
    listReq().flush(page([row]));
    cmp.refundNow(row);
    http.expectOne({ url: `${BOOKINGS_URL}38/refund/`, method: 'POST' }).flush(
      { detail: 'This booking has already been refunded.', code: 'already_refunded' },
      { status: 409, statusText: 'Conflict' },
    );
    expect(snack.mock.calls[0][0]).toBe('This booking has already been refunded.');
    listReq().flush(page([]));
    badgeReq().flush(page([], 0));
  });

  it('cancelling a paid booking reports the refund in the snackbar', async () => {
    const cmp = await open();
    listReq().flush(page([paid(40, 'confirmed', 'paid')]));
    cmp.cancelBooking(paid(40, 'confirmed', 'paid'));
    http.expectOne({ url: `${BOOKINGS_URL}40/`, method: 'PATCH' }).flush(refunded(40, pendingRefund));
    expect(snack.mock.calls[0][0]).toBe('Booking #40 cancelled - refund of €182 sent to Stripe.');
    listReq().flush(page([]));
    badgeReq().flush(page([], 0));
    cmp.cancelBooking(paid(41, 'confirmed', 'paid'));
    http.expectOne({ url: `${BOOKINGS_URL}41/`, method: 'PATCH' }).flush(refunded(41, failedRefund, { can_refund: true }));
    expect(snack.mock.calls[1][0]).toBe("Booking #41 cancelled, but the refund failed: The Stripe key isn't allowed to create refunds. Use Refund now to retry.");
    listReq().flush(page([]));
    badgeReq().flush(page([], 0));
  });

  it('cancel dialog for a booking already refunded in the Stripe Dashboard', async () => {
    const cmp = await open();
    listReq().flush(page([]));
    answer = false;
    const x = paid(42, 'confirmed', 'paid');
    x.payment = { ...x.payment!, refund: { ...pendingRefund, status: 'refunded', refunded_at: '2026-09-27T10:00:00Z' } };
    cmp.cancelBooking(x);
    expect(dialogMessage()).toContain('has already been refunded');
  });

  it('in Greek (TICKET-038): table, chips and the confirm dialog', async () => {
    const cmp = await open();
    TestBed.inject(TranslationService).setLang('el');
    listReq().flush(page([paid(1, 'pending', 'open')]));
    harness.detectChanges();
    await harness.fixture.whenStable();
    const el = text().replace(/[\u00a0\u202f]/g, ' ');
    expect(el).toContain('Κρατήσεις');
    expect(el).toContain('1 κράτηση');
    expect(el).toContain('Αναμένεται πληρωμή');
    expect(el).toContain('έως τις 14:32');
    expect(el).toContain('Σε αναμονή');
    answer = false; // only look at the dialog's text
    cmp.confirmBooking(paid(1, 'pending', 'open'));
    expect(dialogMessage()).toContain('Ο επισκέπτης δεν έχει πληρώσει ακόμη online');
    expect(dialogMessage()).toContain('2 επισκέπτες');
  });
});
