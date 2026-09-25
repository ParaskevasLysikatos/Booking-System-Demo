import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { AdminLayout } from './admin-layout';
import { AdminPlaceholderPage } from './admin-placeholder';

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
              {
                path: 'dashboard',
                component: AdminPlaceholderPage,
                data: { heading: 'Dashboard', icon: 'dashboard', ticket: 'TICKET-023', description: 'Stats' },
              },
              {
                path: 'bookings',
                component: AdminPlaceholderPage,
                data: { heading: 'Bookings', icon: 'event_note', ticket: 'TICKET-025', description: 'All bookings' },
              },
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
    expect(nav).toEqual(['dashboardDashboard', 'holiday_villageProperties', 'event_noteBookings', 'arrow_backBack to site']);
    expect(el.querySelector('nav.side a.active')!.textContent).toContain('Dashboard');
    expect(el.textContent).toContain('Coming in TICKET-023.');

    await harness.navigateByUrl('/admin/bookings');
    expect(el.querySelector('nav.side a.active')!.textContent).toContain('Bookings');
    expect(el.querySelector('nav.side a.active')!.getAttribute('aria-current')).toBe('page');
  });
});
