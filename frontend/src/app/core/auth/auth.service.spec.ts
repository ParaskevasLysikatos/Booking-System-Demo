import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { tokenExpiringIn } from '../../testing/fake-jwt';
import { AuthUser } from './auth.models';
import { authInterceptor } from './auth.interceptor';
import { AUTH_URL, AuthService, safeReturnUrl } from './auth.service';
import { TokenStorage } from './token-storage';

export const guestUser: AuthUser = {
  id: 7, username: 'maria@example.com', email: 'maria@example.com', first_name: 'Maria',
  last_name: '', role: 'guest', phone: '', is_admin: false,
};

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let storage: TokenStorage;
  let router: Router;

  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    storage = TestBed.inject(TokenStorage);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => http.verify());

  it('login stores tokens + user and updates the signals', () => {
    setup();
    const access = tokenExpiringIn(1800);
    const refresh = tokenExpiringIn(86400);
    let result: AuthUser | undefined;
    auth.login({ email: 'maria@example.com', password: 'pw' }).subscribe((u) => (result = u));

    const req = http.expectOne(`${AUTH_URL}/login/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({ access, refresh, user: guestUser });

    expect(result).toEqual(guestUser);
    expect(storage.getAccess()).toBe(access);
    expect(storage.getRefresh()).toBe(refresh);
    expect(storage.getUser()).toEqual(guestUser);
    expect(auth.isLoggedIn()).toBe(true);
    expect(auth.isAdmin()).toBe(false);
  });

  it('register logs the new user in straight away', () => {
    setup();
    auth.register({ email: 'maria@example.com', password: 'pw' }).subscribe();
    http.expectOne(`${AUTH_URL}/register/`).flush(
      { user: { ...guestUser }, access: tokenExpiringIn(1800), refresh: tokenExpiringIn(86400) },
      { status: 201, statusText: 'Created' },
    );
    expect(auth.currentUser()?.email).toBe('maria@example.com');
  });

  it('a failed login leaves no session', () => {
    setup();
    let failed = false;
    auth.login({ email: 'x@example.com', password: 'bad' }).subscribe({ error: () => (failed = true) });
    http.expectOne(`${AUTH_URL}/login/`).flush({ detail: 'No active account' }, { status: 401, statusText: 'Unauthorized' });
    expect(failed).toBe(true);
    expect(auth.isLoggedIn()).toBe(false);
    expect(storage.getAccess()).toBeNull();
  });

  it('logout clears everything and goes home', () => {
    localStorage.setItem('bsd.access', tokenExpiringIn(1800));
    localStorage.setItem('bsd.refresh', tokenExpiringIn(86400));
    localStorage.setItem('bsd.user', JSON.stringify(guestUser));
    setup();
    expect(auth.isLoggedIn()).toBe(true); // restored from storage

    auth.logout();
    expect(auth.isLoggedIn()).toBe(false);
    expect(localStorage.getItem('bsd.access')).toBeNull();
    expect(localStorage.getItem('bsd.refresh')).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  describe('init() on app start', () => {
    it('does nothing without a saved session', async () => {
      setup();
      await auth.init();
      expect(auth.isLoggedIn()).toBe(false);
    });

    it('drops an expired refresh token without calling the API', async () => {
      localStorage.setItem('bsd.refresh', tokenExpiringIn(-60));
      localStorage.setItem('bsd.user', JSON.stringify(guestUser));
      setup();
      await auth.init();
      expect(auth.isLoggedIn()).toBe(false);
      http.expectNone(`${AUTH_URL}/me/`);
    });

    it('re-reads the user (and live role) from /me/', async () => {
      const access = tokenExpiringIn(1800);
      localStorage.setItem('bsd.access', access);
      localStorage.setItem('bsd.refresh', tokenExpiringIn(86400));
      localStorage.setItem('bsd.user', JSON.stringify(guestUser)); // cached as guest
      setup();
      const done = auth.init();
      const req = http.expectOne(`${AUTH_URL}/me/`);
      expect(req.request.headers.get('Authorization')).toBe(`Bearer ${access}`);
      req.flush({ ...guestUser, role: 'admin', is_admin: true }); // promoted meanwhile
      await done;
      expect(auth.isAdmin()).toBe(true);
      expect(storage.getUser()?.role).toBe('admin');
    });

    it('keeps the cached session if the backend is unreachable', async () => {
      localStorage.setItem('bsd.access', tokenExpiringIn(1800));
      localStorage.setItem('bsd.refresh', tokenExpiringIn(86400));
      localStorage.setItem('bsd.user', JSON.stringify(guestUser));
      setup();
      const done = auth.init();
      http.expectOne(`${AUTH_URL}/me/`).error(new ProgressEvent('error'), { status: 0 });
      await done;
      expect(auth.isLoggedIn()).toBe(true);
    });

    it('clears the session when the server rejects it', async () => {
      localStorage.setItem('bsd.access', tokenExpiringIn(1800));
      localStorage.setItem('bsd.refresh', tokenExpiringIn(86400));
      localStorage.setItem('bsd.user', JSON.stringify(guestUser));
      setup();
      const done = auth.init();
      http.expectOne(`${AUTH_URL}/me/`).flush({ detail: 'bad token' }, { status: 401, statusText: 'Unauthorized' });
      http.expectOne(`${AUTH_URL}/refresh/`).flush({ detail: 'expired' }, { status: 401, statusText: 'Unauthorized' });
      await done;
      expect(auth.isLoggedIn()).toBe(false);
      expect(storage.getRefresh()).toBeNull();
    });
  });
});

describe('safeReturnUrl', () => {
  it('only allows same-app paths', () => {
    expect(safeReturnUrl('/my-bookings?x=1')).toBe('/my-bookings?x=1');
    expect(safeReturnUrl(null)).toBe('/');
    expect(safeReturnUrl('https://evil.example')).toBe('/');
    expect(safeReturnUrl('//evil.example')).toBe('/');
    expect(safeReturnUrl('javascript:alert(1)')).toBe('/');
  });
});
