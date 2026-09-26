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
import { addDays, toIsoDate, todayLocal } from '../../../core/dates';
import { PROPERTIES_URL } from '../../../core/properties/property.service';
import { AdminBookingsPage, parseAdminBookingsQuery, toApiQuery } from './admin-bookings';

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
    expect(dialogMessage()).toContain('owed a full refund');
    expect(dialogMessage()).toContain('Stripe dashboard');
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
});
