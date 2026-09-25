import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthService } from './auth.service';

/** /login and /register: an already-logged-in user is sent home instead. */
export const guestOnlyGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? inject(Router).createUrlTree(['/']) : true;
};

/**
 * Pages that need a logged-in user (booking form now; My Bookings in
 * TICKET-021). Logged out -> /login?returnUrl=<where they were going>, and
 * the login page sends them back there afterwards.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.isLoggedIn()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/**
 * The /admin area (TICKET-022). Navigation only - the backend's
 * IsAdminRole / IsAdminOrReadOnly are the real protection (403s).
 *
 * - Logged out -> /login?returnUrl=... (same as authGuard).
 * - Logged in -> re-read the user from the server (GET /auth/me/) before
 *   deciding, so a user demoted since their page loaded is stopped even
 *   though their cached role still says "admin". If the server can't be
 *   reached, fall back to the cached role (the API will still refuse).
 * - Not an admin -> the friendly 403 page (/forbidden?from=...).
 */
export const adminGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const toLogin = () => router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });

  if (!auth.isLoggedIn()) return toLogin();
  try {
    await firstValueFrom(auth.loadMe());
  } catch (err) {
    // 401 even after a refresh attempt: the session is gone (the interceptor
    // already cleared it) -> log in again.
    if (err instanceof HttpErrorResponse && err.status === 401) return toLogin();
    // Otherwise (offline / 5xx): decide on the cached role.
  }
  return auth.isAdmin() ? true : router.createUrlTree(['/forbidden'], { queryParams: { from: state.url } });
};
