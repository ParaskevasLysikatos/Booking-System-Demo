import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { authGuard, guestOnlyGuard } from './auth.guards';

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
});
