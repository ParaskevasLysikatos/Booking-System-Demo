import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';

import { Booking } from '../../core/bookings/booking.models';
import { BOOKINGS_URL } from '../../core/bookings/booking.service';
import { addDays, toIsoDate, todayLocal } from '../../core/dates';
import { MyBookingsPage } from './my-bookings';

const day = (n: number) => toIsoDate(addDays(todayLocal(), n));

const booking = (id: number, overrides: Partial<Booking> = {}): Booking => ({
  id,
  property: { id: 5, title: 'Harbour Loft', location: 'Chania, Greece', price_per_night: '91.00', cover_image: null },
  check_in: day(10), check_out: day(12), nights: 2, guests: 2, total_price: '182.00', status: 'pending',
  can_cancel: true, cancel_deadline: `${day(8)}T15:00:00+02:00`, guest_email: null,
  created_at: new Date().toISOString(),
  ...overrides,
});
const page = (results: Booking[], count = results.length) => ({ count, next: null, previous: null, results });

describe('MyBookingsPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;
  let dialogAnswer: boolean;
  let snack: ReturnType<typeof vi.fn>;

  async function open(url = '/my-bookings'): Promise<MyBookingsPage> {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'my-bookings', component: MyBookingsPage }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    dialogAnswer = true;
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockImplementation(() => ({ afterClosed: () => of(dialogAnswer) }) as never);
    snack = vi.fn();
    vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockImplementation(snack as never);
    harness = await RouterTestingHarness.create();
    return harness.navigateByUrl(url, MyBookingsPage);
  }

  const listReq = (): TestRequest => http.expectOne((r) => r.url === BOOKINGS_URL && r.method === 'GET');
  const text = () => (harness.routeNativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
  async function settle() {
    harness.detectChanges();
    await harness.fixture.whenStable();
  }

  afterEach(() => http.verify());

  it('Upcoming = own, not-cancelled, not checked out; shows the booking card', async () => {
    await open();
    const req = listReq();
    expect(req.request.params.toString()).toBe('when=upcoming&status=pending,confirmed&mine=true');
    req.flush(page([booking(77)]));
    await settle();
    expect(text()).toContain('Harbour Loft');
    expect(text()).toContain('Pending');
    expect(text()).toContain('#77');
    expect(text()).toContain('€182');
    expect(text()).toContain('Free cancellation until');
    expect(text()).toContain('Cancel booking');
  });

  it('tabs live in the URL: Past and Cancelled ask for the right bookings', async () => {
    const pageCmp = await open('/my-bookings?tab=past');
    expect(listReq().request.params.toString()).toBe('when=past&status=pending,confirmed&mine=true');
    pageCmp.selectTab(2);
    await harness.fixture.whenStable();
    expect(router.url).toBe('/my-bookings?tab=cancelled');
    const req = listReq();
    expect(req.request.params.toString()).toBe('status=cancelled&mine=true');
    req.flush(page([]));
    await settle();
    expect(text()).toContain('No cancelled bookings.');
  });

  it('cancel: confirm dialog -> PATCH -> snackbar -> list refreshed', async () => {
    const pageCmp = await open();
    listReq().flush(page([booking(77)]));
    await settle();
    pageCmp.cancel(booking(77));
    expect(pageCmp.cancelling()).toBe(77);
    const patch = http.expectOne(`${BOOKINGS_URL}77/`);
    expect(patch.request.body).toEqual({ status: 'cancelled' });
    patch.flush(booking(77, { status: 'cancelled', can_cancel: false }));
    expect(snack).toHaveBeenCalledWith('Booking #77 cancelled.', 'OK', { duration: 5000 });
    listReq().flush(page([])); // gone from Upcoming
    await settle();
    expect(pageCmp.cancelling()).toBeNull();
    expect(text()).toContain('No upcoming trips yet.');
  });

  it('"Keep booking" sends nothing', async () => {
    const pageCmp = await open();
    listReq().flush(page([booking(77)]));
    dialogAnswer = false;
    pageCmp.cancel(booking(77));
    http.expectNone(`${BOOKINGS_URL}77/`);
    expect(pageCmp.cancelling()).toBeNull();
  });

  it('server refuses (deadline passed meanwhile): shows its reason and refreshes', async () => {
    const pageCmp = await open();
    listReq().flush(page([booking(77)]));
    pageCmp.cancel(booking(77));
    http.expectOne(`${BOOKINGS_URL}77/`).flush(
      { status: ['Online cancellation closed on 2027-01-31 15:00 (48 hours before check-in). Please contact us.'] },
      { status: 400, statusText: 'Bad Request' },
    );
    expect(snack.mock.calls[0][0]).toContain('Online cancellation closed');
    listReq().flush(page([booking(77, { can_cancel: false })]));
    await settle();
    expect(text()).toContain('Can no longer be cancelled online');
    expect(text()).not.toContain('Cancel booking');
  });

  it('marks a stay in progress, hides actions for past/cancelled', async () => {
    await open();
    listReq().flush(
      page([
        booking(1, { check_in: day(-1), check_out: day(2), status: 'confirmed', can_cancel: false }),
        booking(2, { check_in: day(20), check_out: day(22), status: 'cancelled', can_cancel: false }),
      ]),
    );
    await settle();
    expect(text()).toContain('Staying now');
    expect(text()).toContain('Cancelled');
    expect(text().match(/Cancel booking/g)).toBeNull();
  });

  it('error state with Try again', async () => {
    const pageCmp = await open();
    listReq().flush({}, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(text()).toContain("Couldn't load your bookings.");
    pageCmp.retry();
    listReq().flush(page([]));
  });

  it('paginates via the URL', async () => {
    const pageCmp = await open();
    listReq().flush(page(Array.from({ length: 12 }, (_, i) => booking(i + 1)), 20));
    await settle();
    expect(harness.routeNativeElement!.querySelector('mat-paginator')).not.toBeNull();
    pageCmp.onPage({ pageIndex: 1, pageSize: 12, length: 20, previousPageIndex: 0 });
    await harness.fixture.whenStable();
    expect(router.url).toBe('/my-bookings?page=2');
    expect(listReq().request.params.get('page')).toBe('2');
  });
});
