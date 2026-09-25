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
});
