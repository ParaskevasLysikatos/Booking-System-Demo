import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { adminGuard, authGuard, guestOnlyGuard } from './auth.guards';
import { AUTH_URL } from './auth.service';

@Component({ template: 'page' })
class Dummy {}

describe('auth guards', () => {
  async function setup(loggedIn: boolean) {
    localStorage.clear();
    if (loggedIn) localStorage.setItem('bsd.user', JSON.stringify({ id: 1, email: 'g@example.com', role: 'guest' }));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'booking/:id', component: Dummy, canActivate: [authGuard] },
          { path: 'login', component: Dummy, canActivate: [guestOnlyGuard] },
          { path: '', component: Dummy },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    return { harness, router: TestBed.inject(Router) };
  }

  it('authGuard sends a logged-out user to login, remembering where they were going', async () => {
    const { harness, router } = await setup(false);
    await harness.navigateByUrl('/booking/5?check_in=2027-02-02&check_out=2027-02-04&guests=2');
    expect(router.url).toBe('/login?returnUrl=%2Fbooking%2F5%3Fcheck_in%3D2027-02-02%26check_out%3D2027-02-04%26guests%3D2');
  });

  it('authGuard lets a logged-in user through; guestOnlyGuard sends them home from /login', async () => {
    const { harness, router } = await setup(true);
    await harness.navigateByUrl('/booking/5');
    expect(router.url).toBe('/booking/5');
    await harness.navigateByUrl('/login');
    expect(router.url).toBe('/');
  });

  describe('adminGuard', () => {
    /** The guard runs a tick after navigation starts - wait for its /me/ call. */
    async function meRequest(http: HttpTestingController) {
      for (let i = 0; i < 50; i++) {
        const found = http.match(`${AUTH_URL}/me/`);
        if (found.length) return found[0];
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error('adminGuard never called /auth/me/');
    }

    const user = (role: 'guest' | 'admin') => ({ id: 1, email: `${role}@example.com`, role, is_admin: role === 'admin' });

    async function setupAdmin(stored: 'guest' | 'admin' | null) {
      localStorage.clear();
      if (stored) localStorage.setItem('bsd.user', JSON.stringify(user(stored)));
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideRouter([
            { path: 'admin/dashboard', component: Dummy, canActivate: [adminGuard] },
            { path: 'forbidden', component: Dummy },
            { path: 'login', component: Dummy },
          ]),
        ],
      });
      const harness = await RouterTestingHarness.create();
      return { harness, router: TestBed.inject(Router), http: TestBed.inject(HttpTestingController) };
    }

    it('logged out -> login with returnUrl (no API call)', async () => {
      const { harness, router, http } = await setupAdmin(null);
      await harness.navigateByUrl('/admin/dashboard');
      expect(router.url).toBe('/login?returnUrl=%2Fadmin%2Fdashboard');
      http.expectNone(`${AUTH_URL}/me/`);
    });

    it('admin (confirmed by /me/) gets in', async () => {
      const { harness, router, http } = await setupAdmin('admin');
      const nav = harness.navigateByUrl('/admin/dashboard');
      (await meRequest(http)).flush(user('admin'));
      await nav;
      expect(router.url).toBe('/admin/dashboard');
    });

    it('guest -> the 403 page, remembering where they tried to go', async () => {
      const { harness, router, http } = await setupAdmin('guest');
      const nav = harness.navigateByUrl('/admin/dashboard');
      (await meRequest(http)).flush(user('guest'));
      await nav;
      expect(router.url).toBe('/forbidden?from=%2Fadmin%2Fdashboard');
    });

    it('cached "admin" but demoted on the server -> 403 page (server wins)', async () => {
      const { harness, router, http } = await setupAdmin('admin');
      const nav = harness.navigateByUrl('/admin/dashboard');
      (await meRequest(http)).flush(user('guest'));
      await nav;
      expect(router.url).toBe('/forbidden?from=%2Fadmin%2Fdashboard');
    });

    it('server unreachable -> decides on the cached role (API still enforces)', async () => {
      const { harness, router, http } = await setupAdmin('admin');
      const nav = harness.navigateByUrl('/admin/dashboard');
      (await meRequest(http)).error(new ProgressEvent('error'), { status: 0 });
      await nav;
      expect(router.url).toBe('/admin/dashboard');
    });
  });
});
