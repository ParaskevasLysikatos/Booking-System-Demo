import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { AdminStats } from '../../../core/admin/admin-stats.models';
import { ADMIN_STATS_URL } from '../../../core/admin/admin-stats.service';
import { DAILY } from '../../../core/admin/revenue-chart.testing';
import { AdminDashboardPage, buildCards } from './dashboard';
import { setCurrentLang } from '../../../core/i18n/locale';
import { TranslationService } from '../../../core/i18n/translation.service';

const stats = (overrides: Partial<AdminStats> = {}): AdminStats => ({
  period: { from: '2026-09-01', to: '2026-09-30', nights: 30 },
  bookings: { total: 7, pending: 1, confirmed: 5, cancelled: 1, created_in_period: 4 },
  occupancy: { rate: 0.2667, booked_nights: 8, pending_nights: 3, available_nights: 30, closed_nights: 0, active_properties: 3 },
  revenue: { confirmed: '626.67', pending: '300.00' },
  properties: [
    { id: 1, title: 'Alpha', is_active: true, booked_nights: 3, pending_nights: 3, closed_nights: 0, occupancy_rate: 0.3, revenue: '300.00', pending_revenue: '300.00' },
    { id: 2, title: 'Beta', is_active: true, booked_nights: 5, pending_nights: 0, closed_nights: 0, occupancy_rate: 0.5, revenue: '166.67', pending_revenue: '0.00' },
    { id: 3, title: 'Gamma', is_active: false, booked_nights: 2, pending_nights: 0, closed_nights: 0, occupancy_rate: 0.2, revenue: '160.00', pending_revenue: '0.00' },
  ],
  series: DAILY,
  ...overrides,
});

describe('buildCards', () => {
  it('derives every card value from the stats (and the previous period)', () => {
    const prev = stats({
      revenue: { confirmed: '500.00', pending: '0.00' },
      occupancy: { rate: 0.2, booked_nights: 6, pending_nights: 0, available_nights: 30, closed_nights: 0, active_properties: 3 },
      bookings: { total: 8, pending: 0, confirmed: 8, cancelled: 0, created_in_period: 2 },
      properties: [{ id: 1, title: 'Alpha', is_active: true, booked_nights: 10, pending_nights: 0, closed_nights: 0, occupancy_rate: 0.3, revenue: '500.00', pending_revenue: '0.00' }],
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
        occupancy: { rate: null, booked_nights: 0, pending_nights: 0, available_nights: 0, closed_nights: 0, active_properties: 0 },
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

  it('closed nights (TICKET-045): shown under occupancy, only when there are some', () => {
    expect(buildCards(stats(), null).closedNights).toBe(0);
    const c = buildCards(
      stats({ occupancy: { rate: 0.3333, booked_nights: 8, pending_nights: 0, available_nights: 24, closed_nights: 6, active_properties: 1 } }),
      null,
    );
    expect(c.closedNights).toBe(6);
    expect(c.occupancyDetail).toBe('8 of 24 nights booked · 1 active property');
  });

  it('in Greek (TICKET-038): money, %, points and the occupancy line', () => {
    setCurrentLang('el');
    try {
      const prev = stats({ occupancy: { rate: 0.2, booked_nights: 6, pending_nights: 0, available_nights: 30, closed_nights: 0, active_properties: 3 } });
      const c = buildCards(stats(), prev);
      const plain = (s: string | null | undefined) => (s ?? '').replace(/[\u00a0\u202f]/g, ' ');
      expect(plain(c.revenue)).toBe('626,67 €');
      expect(plain(c.occupancyPct)).toBe('26,7%');
      expect(c.occupancyDelta?.text).toBe('▲ 6,7 μον.');
      expect(c.occupancyDetail).toBe('8 από 30 νύχτες κρατημένες · 3 ενεργά καταλύματα');
    } finally {
      setCurrentLang('en');
    }
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

  it('the occupancy card says how many closed nights were left out (TICKET-045)', async () => {
    await open('/admin/dashboard');
    const [current, previous] = calls();
    current.flush(stats({ occupancy: { rate: 0.3333, booked_nights: 8, pending_nights: 0, available_nights: 24, closed_nights: 6, active_properties: 1 } }));
    previous.flush(stats());
    harness.detectChanges();
    expect(text()).toContain('6 closed nights not counted');
    expect(harness.routeNativeElement!.querySelectorAll('.closed-nights').length).toBe(1);
  });

  it('no closed-nights line without closed nights (TICKET-045)', async () => {
    await open('/admin/dashboard');
    for (const r of calls()) r.flush(stats());
    harness.detectChanges();
    expect(harness.routeNativeElement!.querySelector('.closed-nights')).toBeNull();
  });

  it('the revenue chart sits between the cards and the per-property table (TICKET-035)', async () => {
    await open('/admin/dashboard');
    expect(harness.routeNativeElement!.querySelector('.chart-skeleton')).not.toBeNull(); // while loading
    calls().forEach((c) => c.flush(stats()));
    harness.detectChanges();
    const root = harness.routeNativeElement!;
    const order = [...root.querySelectorAll('.cards, app-revenue-chart, app-property-breakdown')].map((e) =>
      e.tagName === 'DIV' ? 'cards' : e.tagName.toLowerCase(),
    );
    expect(order).toEqual(['cards', 'app-revenue-chart', 'app-property-breakdown']);
    expect(root.querySelectorAll('app-revenue-chart rect.hit').length).toBe(10);
    expect(text()).toContain('Revenue (confirmed) €626.67'); // the chart's legend = the Revenue card
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

  it('in Greek (TICKET-038): presets, cards, chart and table', async () => {
    await open('/admin/dashboard?period=custom&from=2026-07-10&to=2026-08-08');
    TestBed.inject(TranslationService).setLang('el');
    const [current, previous] = calls();
    current.flush(stats());
    previous.flush(stats({ revenue: { confirmed: '500.00', pending: '0.00' } }));
    harness.detectChanges();
    await harness.fixture.whenStable();
    const el = text().replace(/[\u00a0\u202f]/g, ' ');
    expect(el).toContain('Πίνακας ελέγχου');
    expect(el).toContain('10 Ιουλ – 8 Αυγ 2026 · 30 νύχτες');
    expect(el).toContain('▲ 25% έναντι των προηγούμενων 30 ημερών');
    expect(el).toContain('Αυτός ο μήνας');
    expect(el).toContain('+ 300 € αναμενόμενα από κρατήσεις σε αναμονή');
    expect(el).toContain('5 επιβεβαιωμένες');
    expect(el).toContain('4 νέες κρατήσεις έγιναν σε αυτή την περίοδο');
    expect(el).toContain('Έσοδα ανά χρονικό διάστημα');
    expect(el).toContain('Ανά κατάλυμα · ταξινόμηση κατά έσοδα');
    expect(el).toContain('GammaΑποσυρμένο');
  });
});
