import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { BOOKINGS_URL } from '../../core/bookings/booking.service';
import { AdminLayout } from './admin-layout';

@Component({ template: '<p>child page</p>' })
class StubPage {}

describe('AdminLayout', () => {
  it('redirects /admin to the dashboard, shows the side nav and the child page', async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          {
            path: 'admin',
            component: AdminLayout,
            children: [
              { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
              { path: 'dashboard', component: StubPage },
              { path: 'bookings', component: StubPage },
            ],
          },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin');
    const router = TestBed.inject(Router);
    expect(router.url).toBe('/admin/dashboard');
    const el = harness.fixture.nativeElement as HTMLElement;
    const nav = [...el.querySelectorAll('nav.side a')].map((a) => a.textContent!.trim());
    expect(nav.map((t) => t.replace(/\d+$/, ''))).toEqual(['dashboardDashboard', 'holiday_villageProperties', 'event_noteBookings', 'arrow_backBack to site']);
    expect(el.querySelector('nav.side a.active')!.textContent).toContain('Dashboard');
    expect(el.textContent).toContain('child page');

    await harness.navigateByUrl('/admin/bookings');
    expect(el.querySelector('nav.side a.active')!.textContent).toContain('Bookings');
    expect(el.querySelector('nav.side a.active')!.getAttribute('aria-current')).toBe('page');

    // Pending badge on "Bookings" (TICKET-025)
    TestBed.inject(HttpTestingController)
      .expectOne((r) => r.url === BOOKINGS_URL)
      .flush({ count: 3, next: null, previous: null, results: [] });
    harness.detectChanges();
    const badge = el.querySelector('nav.side .badge')!;
    expect(badge.textContent!.trim()).toBe('3');
    expect(badge.getAttribute('aria-label')).toBe('3 pending bookings');
  });
});
