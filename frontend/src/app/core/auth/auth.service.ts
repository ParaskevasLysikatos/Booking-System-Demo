import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, finalize, firstValueFrom, map, shareReplay, tap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthResponse, AuthUser, LoginRequest, RegisterRequest } from './auth.models';
import { isTokenExpired } from './jwt';
import { TokenStorage } from './token-storage';

export const AUTH_URL = `${environment.apiUrl}/auth`;

/**
 * Owns the logged-in session (TICKET-017).
 *
 * - `currentUser` / `isLoggedIn` / `isAdmin` are signals the UI (toolbar
 *   now, guards + role-aware navbar in TICKET-021/022) reads directly.
 * - Tokens + a cached copy of the user live in TokenStorage (localStorage).
 * - The cached user is only for instant rendering after a reload; `init()`
 *   re-fetches /auth/me/ so the role always comes from the server. The
 *   role claim inside the JWT is never trusted for anything.
 */
/** How long app start waits for /auth/me/ before rendering anyway. */
export const INIT_MAX_WAIT_MS = 3000;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly storage = inject(TokenStorage);

  private readonly user = signal<AuthUser | null>(this.storage.getUser());

  readonly currentUser = this.user.asReadonly();
  readonly isLoggedIn = computed(() => this.user() !== null);
  readonly isAdmin = computed(() => this.user()?.role === 'admin');

  /** The one refresh request in flight, shared by every caller that hits a 401 meanwhile. */
  private refreshInFlight$: Observable<string> | null = null;

  // --- session lifecycle --------------------------------------------------

  /**
   * Called once at app start (provideAppInitializer). Never blocks the app
   * on a failure: a dead/expired session is just cleared, and if the
   * backend is unreachable the cached user is kept until it's back.
   */
  async init(): Promise<void> {
    const refresh = this.storage.getRefresh();
    if (!refresh || isTokenExpired(refresh, 0)) {
      this.clearSession();
      return;
    }
    const check = firstValueFrom(this.loadMe()).then(
      () => undefined,
      (err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 401) {
          this.clearSession(); // refresh was rejected too - session is gone
        }
        // status 0 / 5xx: backend down - keep the cached session for now.
      },
    );
    // A sleeping (free Render) API can take ~50 s to answer. Don't keep the
    // whole app blank that long: after INIT_MAX_WAIT_MS render with the cached
    // user and let the check finish in the background (TICKET-027). The server
    // still enforces every permission, and adminGuard re-reads /me/ itself.
    await Promise.race([check, new Promise<void>((resolve) => setTimeout(resolve, INIT_MAX_WAIT_MS))]);
  }

  login(credentials: LoginRequest): Observable<AuthUser> {
    return this.http
      .post<AuthResponse>(`${AUTH_URL}/login/`, credentials)
      .pipe(map((res) => this.startSession(res)));
  }

  /** Register returns tokens too, so the new user is logged in straight away. */
  register(data: RegisterRequest): Observable<AuthUser> {
    return this.http
      .post<AuthResponse>(`${AUTH_URL}/register/`, data)
      .pipe(map((res) => this.startSession(res)));
  }

  /** GET /auth/me/ - the always-current user, including the live role. */
  loadMe(): Observable<AuthUser> {
    return this.http.get<AuthUser>(`${AUTH_URL}/me/`).pipe(
      tap((user) => {
        this.user.set(user);
        this.storage.setUser(user);
      }),
    );
  }

  /** User-initiated logout. No server call: tokens aren't blacklisted in this demo (see README). */
  logout(): void {
    this.clearSession();
    void this.router.navigateByUrl('/');
  }

  /**
   * The refresh token was rejected (expired/invalid) mid-use: drop the
   * session and send the user to log in again, coming back afterwards.
   */
  expireSession(): void {
    const returnUrl = this.router.url;
    this.clearSession();
    const onAuthPage = returnUrl.startsWith('/login') || returnUrl.startsWith('/register');
    void this.router.navigate(['/login'], {
      queryParams: onAuthPage ? { reason: 'expired' } : { returnUrl, reason: 'expired' },
    });
  }

  // --- tokens -------------------------------------------------------------

  accessToken(): string | null {
    return this.storage.getAccess();
  }

  hasRefreshToken(): boolean {
    return !!this.storage.getRefresh();
  }

  /**
   * Exchange the refresh token for a new access token. Concurrent callers
   * (several requests 401-ing at once) all share the same single request.
   */
  refreshAccessToken(): Observable<string> {
    if (this.refreshInFlight$) return this.refreshInFlight$;

    const refresh = this.storage.getRefresh();
    if (!refresh) {
      return throwError(() => new Error('No refresh token'));
    }
    this.refreshInFlight$ = this.http
      .post<{ access: string }>(`${AUTH_URL}/refresh/`, { refresh })
      .pipe(
        map((res) => {
          this.storage.setTokens(res.access);
          return res.access;
        }),
        finalize(() => (this.refreshInFlight$ = null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    return this.refreshInFlight$;
  }

  // --- internals ----------------------------------------------------------

  private startSession(res: AuthResponse): AuthUser {
    this.storage.setTokens(res.access, res.refresh);
    this.storage.setUser(res.user);
    this.user.set(res.user);
    return res.user;
  }

  private clearSession(): void {
    this.storage.clear();
    this.user.set(null);
    this.refreshInFlight$ = null;
  }
}

/** Helper for templates/tests that only need to know the default landing page. */
export const HOME_URL = '/';

export function safeReturnUrl(url: string | null | undefined): string {
  // Only same-app paths - never "//evil.com" or "https://..." (open redirect).
  if (!url || !url.startsWith('/') || url.startsWith('//')) return HOME_URL;
  return url;
}

