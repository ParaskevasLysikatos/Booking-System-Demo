import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AUTH_URL, AuthService } from './auth.service';

/** Endpoints that must never carry (or react to) the access token. */
const PUBLIC_AUTH_ENDPOINTS = [`${AUTH_URL}/login/`, `${AUTH_URL}/register/`, `${AUTH_URL}/refresh/`];

function isOurApi(url: string): boolean {
  return url.startsWith(`${environment.apiUrl}/`);
}

function withToken(req: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

/**
 * TICKET-017: attaches the JWT and transparently refreshes it.
 *
 * 1. Requests to our API (and only our API - a token never leaks to a
 *    third-party URL) get `Authorization: Bearer <access>`. login/,
 *    register/ and refresh/ are left untouched.
 * 2. If the API answers 401 and we hold a refresh token, refresh ONCE and
 *    replay the original request with the new access token. Concurrent
 *    401s share one refresh call (AuthService.refreshAccessToken).
 * 3. If the refresh itself fails, the session is over: log out and send
 *    the user to /login?returnUrl=... . The replayed request goes straight
 *    to the next handler (not back through this interceptor), so a second
 *    401 can never trigger another refresh - no loops.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isOurApi(req.url) || PUBLIC_AUTH_ENDPOINTS.includes(req.url)) {
    return next(req);
  }

  const auth = inject(AuthService);
  const token = auth.accessToken();
  const outgoing = token ? withToken(req, token) : req;

  return next(outgoing).pipe(
    catchError((err: unknown) => {
      const unauthorized = err instanceof HttpErrorResponse && err.status === 401;
      if (!unauthorized || !auth.hasRefreshToken()) {
        return throwError(() => err);
      }
      return auth.refreshAccessToken().pipe(
        catchError(() => {
          auth.expireSession();
          return throwError(() => err); // surface the original 401 to the caller
        }),
        switchMap((newToken) => next(withToken(req, newToken))),
      );
    }),
  );
};
