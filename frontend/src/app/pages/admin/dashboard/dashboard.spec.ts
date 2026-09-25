import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { AdminStats } from '../../../core/admin/admin-stats.models';
import { ADMIN_STATS_URL } from '../../../core/admin/admin-stats.service';
import { AdminDashboardPage, buildCards } from './dashboard';

const stats = (overrides: Partial<AdminStats> = {}): AdminStats => ({
  period: { from: '2026-09-01', to: '2026-09-30', nights: 30 },
  bookings: { total: 7, pending: 1, confirmed: 5, cancelled: 1, created_in_period: 4 },
  occupancy: { rate: 0.2667, booked_nights: 8, pending_nights: 3, available_nights: 30, active_properties: 3 },
  revenue: { confirmed: '626.67', pending: '300.00' },
  properties: [
    { id: 1, title: 'Alpha', is_active: true, booked_nights: 3, pending_nights: 3, occupancy_rate: 0.3, revenue: '300.00', pending_revenue: '300.00' },
    { id: 2, title: 'Beta', is_active: true, booked_nights: 5, pending_nights: 0, occupancy_rate: 0.5, revenue: '166.67', pending_revenue: '0.00' },
    { id: 3, title: 'Gamma', is_active: false, booked_nights: 2, pending_nights: 0, occupancy_rate: 0.2, revenue: '160.00', pending_revenue: '0.00' },
  ],
  ...overrides,
});

describe('buildCards', () => {
  it('derives every card value from the stats (and the previous period)', () => {
    const prev = stats({
      revenue: { confirmed: '500.00', pending: '0.00' },
      occupancy: { rate: 0.2, booked_nights: 6, pending_nights: 0, available_nights: 30, active_properties: 3 },
      bookings: { total: 8, pending: 0, confirmed: 8, cancelled: 0, created_in_period: 2 },
      properties: [{ id: 1, title: 'Alpha', is_active: true, booked_nights: 10, pending_nights: 0, occupancy_rate: 0.3, revenue: '500.00', pending_revenue: '0.00' }],
    });
    const c = buildCards(stats(), prev);
    expect(c.revenue).toBe('€626.67');
    expect(c.revenueExpected).toBe('€300');
    expect(c.revenueDelta?.text).toBe('▲ 25%');
    expect(c.occupancyPct).toBe('26.7%');
    expect(c.occupancyDetail).toBe('8 of 30 nights booked · 3 active properties');
    expect(c.occupancyDelta?.text).toBe('▲ 6.7 pts');
    expect(c.stays).toBe(6); // confirmed + pending (cancelled shown separately)
    expect(c.staysDelta).toEqual({ text: '▼ 25%', good: false, direction: 'down' });
    // ADR: 626.67 / (3+5+2) nights = 62.667 -> €62.67 ; previous 500/10 = 50 -> ▲ 25%
    expect(c.avgNight).toBe('€62.67');
    expect(c.avgNightDelta?.text).toBe('▲ 25%');
    expect(c.empty).toBe(false);
  });

  it('handles no active properties / no bookings / no comparison', () => {
    const c = buildCards(
      stats({
        bookings: { total: 0, pending: 0, confirmed: 0, cancelled: 0, created_in_period: 0 },
        occupancy: { rate: null, booked_nights: 0, pending_nights: 0, available_nights: 0, active_properties: 0 },
        revenue: { confirmed: '0.00', pending: '0.00' },
        properties: [],
      }),
      null,
    );
    expect(c.occupancyPct).toBe('–');
    expect(c.avgNight).toBeNull();
    expect(c.revenueDelta).toBeNull();
    expect(c.revenueExpected).toBeNull();
    expect(c.empty).toBe(true);
  });
});

describe('AdminDashboardPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;

  async function open(url: string): Promise<AdminDashboardPage> {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'admin/dashboard', component: AdminDashboardPage }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    return harness.navigateByUrl(url, AdminDashboardPage);
  }

  const calls = (): TestRequest[] => http.match((r) => r.url === ADMIN_STATS_URL);
  const text = () => (harness.routeNativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ').replace(/ /g, ' ');

  it('loads the period from the URL plus the comparison period, and renders cards + table', async () => {
    await open('/admin/dashboard?period=custom&from=2026-07-10&to=2026-08-08');
    const [current, previous] = calls();
    expect(current.request.params.toString()).toBe('from=2026-07-10&to=2026-08-08');
    expect(previous.request.params.toString()).toBe('from=2026-06-10&to=2026-07-09'); // 30 days before
    current.flush(stats());
    previous.flush(stats({ revenue: { confirmed: '500.00', pending: '0.00' } }));
    harness.detectChanges();
    expect(text()).toContain('10 Jul – 8 Aug 2026 · 30 nights');
    expect(text()).toContain('€626.67');
    expect(text()).toContain('▲ 25% vs previous 30 days');
    expect(text()).toContain('+ €300 expected from pending bookings');
    expect(text()).toContain('26.7%');
    expect(text()).toContain('5 confirmed');
    expect(text()).toContain('4 new bookings made in this period');
    const rows = [...harness.routeNativeElement!.querySelectorAll('app-property-breakdown tbody tr')];
    expect(rows.map((r) => r.querySelector('th')!.textContent!.trim())).toEqual(['Alpha', 'Beta', 'GammaRetired']);
  });

  it('presets update the URL (default = this month, no params)', async () => {
    const page = await open('/admin/dashboard');
    calls().forEach((c) => c.flush(stats()));
    page.selectPreset('last-12');
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/admin/dashboard?period=last-12');
    expect(calls().length).toBe(2);
  });

  it('a failing comparison still shows the numbers (without deltas)', async () => {
    await open('/admin/dashboard');
    const [current, previous] = calls();
    current.flush(stats());
    previous.flush({}, { status: 500, statusText: 'Server Error' });
    harness.detectChanges();
    expect(text()).toContain('€626.67');
    expect(text()).not.toContain('▲');
  });

  it('error state with Try again', async () => {
    const page = await open('/admin/dashboard');
    const [current] = calls();
    current.flush({}, { status: 500, statusText: 'Server Error' }); // (the comparison call is cancelled by forkJoin)
    harness.detectChanges();
    expect(text()).toContain("Couldn't load the stats.");
    page.retry();
    expect(calls().length).toBe(2);
  });

  it('empty period hint', async () => {
    await open('/admin/dashboard');
    const empty = stats({ bookings: { total: 0, pending: 0, confirmed: 0, cancelled: 0, created_in_period: 0 }, properties: [] });
    calls().forEach((c) => c.flush(empty));
    harness.detectChanges();
    expect(text()).toContain('No bookings in this period.');
  });
});
