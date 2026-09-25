import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { ForbiddenPage } from './forbidden';

@Component({ template: '' })
class Dummy {}

describe('ForbiddenPage', () => {
  it('explains who is logged in, and "Log in as someone else" logs out and returns to the admin page after', async () => {
    localStorage.clear();
    localStorage.setItem('bsd.user', JSON.stringify({ id: 1, email: 'guest@example.com', role: 'guest' }));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'forbidden', component: ForbiddenPage },
          { path: 'login', component: Dummy },
          { path: '', component: Dummy },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/forbidden?from=%2Fadmin%2Fbookings', ForbiddenPage);
    const text = (harness.routeNativeElement as HTMLElement).textContent!;
    expect(text).toContain('Admins only');
    expect(text).toContain('guest@example.com');

    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true); // logout's own redirect
    page.switchAccount();
    expect(localStorage.getItem('bsd.user')).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/admin/bookings' } });
  });
});
