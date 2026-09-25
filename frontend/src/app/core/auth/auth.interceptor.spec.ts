import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { environment } from '../../../environments/environment';
import { tokenExpiringIn } from '../../testing/fake-jwt';
import { authInterceptor } from './auth.interceptor';
import { AUTH_URL, AuthService } from './auth.service';

const API = environment.apiUrl;
const unauthorized = { status: 401, statusText: 'Unauthorized' };

describe('authInterceptor', () => {
  let client: HttpClient;
  let http: HttpTestingController;
  let router: Router;
  let access: string;
  let refresh: string;

  beforeEach(() => {
    localStorage.clear();
    access = tokenExpiringIn(1800, { n: 1 });
    refresh = tokenExpiringIn(86400, { token_type: 'refresh' });
    localStorage.setItem('bsd.access', access);
    localStorage.setItem('bsd.refresh', refresh);
    localStorage.setItem('bsd.user', JSON.stringify({ id: 1, email: 'g@example.com', role: 'guest' }));

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => http.verify());

  it('adds the bearer token to our API only', () => {
    client.get(`${API}/bookings/`).subscribe();
    client.get('https://picsum.photos/200').subscribe();
    client.get('http://localhost:8000/api-other/x').subscribe(); // prefix look-alike

    expect(http.expectOne(`${API}/bookings/`).request.headers.get('Authorization')).toBe(`Bearer ${access}`);
    expect(http.expectOne('https://picsum.photos/200').request.headers.has('Authorization')).toBe(false);
    expect(http.expectOne('http://localhost:8000/api-other/x').request.headers.has('Authorization')).toBe(false);
  });

  it('never attaches the token to login/register/refresh', () => {
    for (const path of ['login', 'register', 'refresh']) {
      client.post(`${AUTH_URL}/${path}/`, {}).subscribe();
      expect(http.expectOne(`${AUTH_URL}/${path}/`).request.headers.has('Authorization')).toBe(false);
    }
  });

  it('sends no header when logged out', () => {
    localStorage.clear();
    client.get(`${API}/properties/`).subscribe();
    expect(http.expectOne(`${API}/properties/`).request.headers.has('Authorization')).toBe(false);
  });

  it('on 401: refreshes once, stores the new token, retries the request', () => {
    const fresh = tokenExpiringIn(1800, { n: 2 });
    let body: unknown;
    client.get(`${API}/bookings/`).subscribe((b) => (body = b));

    http.expectOne(`${API}/bookings/`).flush({ detail: 'expired' }, unauthorized);
    const refreshReq = http.expectOne(`${AUTH_URL}/refresh/`);
    expect(refreshReq.request.body).toEqual({ refresh });
    refreshReq.flush({ access: fresh });

    const retry = http.expectOne(`${API}/bookings/`);
    expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${fresh}`);
    retry.flush({ results: [] });

    expect(body).toEqual({ results: [] });
    expect(localStorage.getItem('bsd.access')).toBe(fresh);
  });

  it('concurrent 401s share ONE refresh call', () => {
    const fresh = tokenExpiringIn(1800, { n: 3 });
    const results: unknown[] = [];
    client.get(`${API}/a/`).subscribe((r) => results.push(r));
    client.get(`${API}/b/`).subscribe((r) => results.push(r));
    client.get(`${API}/c/`).subscribe((r) => results.push(r));

    for (const p of ['a', 'b', 'c']) http.expectOne(`${API}/${p}/`).flush({}, unauthorized);
    http.expectOne(`${AUTH_URL}/refresh/`).flush({ access: fresh }); // exactly one - expectOne would throw otherwise
    for (const p of ['a', 'b', 'c']) {
      const retry = http.expectOne(`${API}/${p}/`);
      expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${fresh}`);
      retry.flush(p);
    }
    expect(results.sort()).toEqual(['a', 'b', 'c']);
  });

  it('when the refresh fails: logs out, redirects to /login with returnUrl, surfaces the 401', () => {
    let error: HttpErrorResponse | undefined;
    client.get(`${API}/bookings/`).subscribe({ error: (e) => (error = e) });

    http.expectOne(`${API}/bookings/`).flush({ detail: 'expired' }, unauthorized);
    http.expectOne(`${AUTH_URL}/refresh/`).flush({ detail: 'Token is invalid or expired' }, unauthorized);

    expect(error?.status).toBe(401);
    expect(TestBed.inject(AuthService).isLoggedIn()).toBe(false);
    expect(localStorage.getItem('bsd.refresh')).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/', reason: 'expired' },
    });
  });

  it('a retried request that 401s again does not loop', () => {
    let error: HttpErrorResponse | undefined;
    client.get(`${API}/admin/stats/`).subscribe({ error: (e) => (error = e) });

    http.expectOne(`${API}/admin/stats/`).flush({}, unauthorized);
    http.expectOne(`${AUTH_URL}/refresh/`).flush({ access: tokenExpiringIn(1800, { n: 4 }) });
    http.expectOne(`${API}/admin/stats/`).flush({}, unauthorized); // still 401 after refresh

    expect(error?.status).toBe(401);
    http.expectNone(`${AUTH_URL}/refresh/`); // no second refresh
  });

  it('without a refresh token a 401 just passes through', () => {
    localStorage.removeItem('bsd.refresh');
    let error: HttpErrorResponse | undefined;
    client.get(`${API}/bookings/`).subscribe({ error: (e) => (error = e) });
    http.expectOne(`${API}/bookings/`).flush({}, unauthorized);
    expect(error?.status).toBe(401);
    http.expectNone(`${AUTH_URL}/refresh/`);
  });

  it('non-401 errors are untouched', () => {
    let error: HttpErrorResponse | undefined;
    client.post(`${API}/bookings/`, {}).subscribe({ error: (e) => (error = e) });
    http.expectOne(`${API}/bookings/`).flush({ detail: 'taken' }, { status: 409, statusText: 'Conflict' });
    expect(error?.status).toBe(409);
    http.expectNone(`${AUTH_URL}/refresh/`);
  });
});
