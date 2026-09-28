import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';

import { tokenExpiringIn } from '../../testing/fake-jwt';
import { AuthUser } from '../auth/auth.models';
import { AUTH_URL, AuthService } from '../auth/auth.service';
import {
  FAVORITES_URL,
  FavoriteService,
  FavoriteTarget,
  PENDING_FAVORITE_KEY,
  PENDING_FAVORITE_MAX_AGE_MS,
} from './favorite.service';

const guest: AuthUser = {
  id: 7,
  username: 'maria@example.com',
  email: 'maria@example.com',
  first_name: 'Maria',
  last_name: '',
  role: 'guest',
  phone: '',
  is_admin: false,
};
const admin: AuthUser = {
  ...guest,
  id: 1,
  email: 'admin@example.com',
  role: 'admin',
  is_admin: true,
};
const otherGuest: AuthUser = { ...guest, id: 8, email: 'nikos@example.com' };

const loft: FavoriteTarget = { id: 5, title: 'Harbour Loft', is_favorite: false };
const villa: FavoriteTarget = { id: 6, title: 'Sea Villa', is_favorite: true };

describe('FavoriteService', () => {
  let favorites: FavoriteService;
  let auth: AuthService;
  let http: HttpTestingController;
  let router: Router;
  let snack: ReturnType<typeof vi.fn>;

  function setup(user: AuthUser | null = guest) {
    localStorage.clear();
    if (user) {
      localStorage.setItem('bsd.user', JSON.stringify(user));
      localStorage.setItem('bsd.access', tokenExpiringIn(1800));
      localStorage.setItem('bsd.refresh', tokenExpiringIn(86400));
    }
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    auth = TestBed.inject(AuthService);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    snack = vi.fn();
    vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockImplementation(snack as never);
    favorites = TestBed.inject(FavoriteService);
    TestBed.tick(); // run the service's user effect once, as the app would
  }

  function logIn(user: AuthUser) {
    auth.login({ email: user.email, password: 'pw' }).subscribe();
    http
      .expectOne(`${AUTH_URL}/login/`)
      .flush({ access: tokenExpiringIn(1800), refresh: tokenExpiringIn(86400), user });
    TestBed.tick();
  }

  const favReq = (id: number) => http.expectOne(`${FAVORITES_URL}${id}/`);

  beforeEach(() => sessionStorage.clear());
  afterEach(() => http.verify());

  it('starts from the server’s is_favorite', () => {
    setup();
    expect(favorites.isSaved(loft)).toBe(false);
    expect(favorites.isSaved(villa)).toBe(true);
    expect(favorites.isSaved({ id: 9, title: 'No flag' })).toBe(false);
  });

  it('saves optimistically with PUT, then removes with DELETE', () => {
    setup();
    favorites.toggle(loft);
    expect(favorites.isSaved(loft)).toBe(true); // before the server answers
    expect(favorites.isBusy(loft.id)).toBe(true);
    const put = favReq(loft.id);
    expect(put.request.method).toBe('PUT');
    put.flush(
      { property: 5, is_favorite: true, saved_at: '2026-09-28T17:00:00+03:00' },
      { status: 201, statusText: 'Created' },
    );
    expect(favorites.isBusy(loft.id)).toBe(false);

    favorites.toggle(loft); // the override wins over the card's stale is_favorite: false
    expect(favorites.isSaved(loft)).toBe(false);
    const del = favReq(loft.id);
    expect(del.request.method).toBe('DELETE');
    del.flush(null, { status: 204, statusText: 'No Content' });
    expect(favorites.isSaved(loft)).toBe(false);
    expect(snack).not.toHaveBeenCalled();
  });

  it('ignores a second tap while that place’s request is running', () => {
    setup();
    favorites.toggle(loft);
    favorites.toggle(loft);
    favReq(loft.id).flush({ property: 5, is_favorite: true, saved_at: '' });
    expect(favorites.isSaved(loft)).toBe(true);
  });

  it('other places are not blocked by a running request', () => {
    setup();
    favorites.toggle(loft);
    favorites.toggle(villa);
    expect(favorites.isSaved(villa)).toBe(false);
    favReq(loft.id).flush({ property: 5, is_favorite: true, saved_at: '' });
    favReq(villa.id).flush(null, { status: 204, statusText: 'No Content' });
  });

  it('switches back and explains when saving fails', () => {
    setup();
    favorites.toggle(loft);
    favReq(loft.id).flush(
      { detail: 'No Property matches the given query.' },
      { status: 404, statusText: 'Not Found' },
    );
    expect(favorites.isSaved(loft)).toBe(false);
    expect(snack).toHaveBeenCalledWith(
      'This place is no longer available, so it can’t be saved.',
      'OK',
      { duration: 6000 },
    );
  });

  it('switches back when removing fails (network down)', () => {
    setup();
    favorites.toggle(villa);
    expect(favorites.isSaved(villa)).toBe(false);
    favReq(villa.id).error(new ProgressEvent('error'), { status: 0 });
    expect(favorites.isSaved(villa)).toBe(true);
    expect(snack.mock.calls[0][0]).toBe(
      "Couldn’t remove this place. Can't reach the server. Check your connection and try again.",
    );
  });

  it('logged out: parks the tap and goes to log in, coming back to this page', () => {
    setup(null);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/listings?location=crete');
    favorites.toggle(loft);
    http.expectNone(`${FAVORITES_URL}${loft.id}/`);
    expect(favorites.isSaved(loft)).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/listings?location=crete', reason: 'favorite' },
    });
    expect(JSON.parse(sessionStorage.getItem(PENDING_FAVORITE_KEY)!)).toMatchObject({
      id: 5,
      title: 'Harbour Loft',
    });
  });

  it('completes the parked save right after logging in', () => {
    setup(null);
    favorites.toggle(loft);
    logIn(guest);
    expect(sessionStorage.getItem(PENDING_FAVORITE_KEY)).toBeNull();
    expect(favorites.isSaved(loft)).toBe(true);
    const put = favReq(loft.id);
    expect(put.request.method).toBe('PUT');
    put.flush(
      { property: 5, is_favorite: true, saved_at: '' },
      { status: 201, statusText: 'Created' },
    );
    expect(snack).toHaveBeenCalledWith('Saved “Harbour Loft”.', 'OK', { duration: 4000 });
  });

  it('completes a parked save after a page reload on the login screen', () => {
    sessionStorage.setItem(
      PENDING_FAVORITE_KEY,
      JSON.stringify({ id: 5, title: 'Harbour Loft', at: Date.now() }),
    );
    setup(guest); // the app starts already logged in
    favReq(loft.id).flush({ property: 5, is_favorite: true, saved_at: '' });
    expect(favorites.isSaved(loft)).toBe(true);
  });

  it('drops a parked save that is too old or broken', () => {
    sessionStorage.setItem(
      PENDING_FAVORITE_KEY,
      JSON.stringify({
        id: 5,
        title: 'Harbour Loft',
        at: Date.now() - PENDING_FAVORITE_MAX_AGE_MS - 1000,
      }),
    );
    setup(guest);
    http.expectNone(`${FAVORITES_URL}5/`);
    expect(sessionStorage.getItem(PENDING_FAVORITE_KEY)).toBeNull();

    sessionStorage.setItem(PENDING_FAVORITE_KEY, '{not json');
    logIn(otherGuest);
    http.expectNone(() => true);
  });

  it('an admin logging in drops the parked save (admins have no hearts)', () => {
    setup(null);
    favorites.toggle(loft);
    logIn(admin);
    http.expectNone(`${FAVORITES_URL}${loft.id}/`);
    expect(sessionStorage.getItem(PENDING_FAVORITE_KEY)).toBeNull();
    expect(favorites.available()).toBe(false);
  });

  it('admins: toggle does nothing', () => {
    setup(admin);
    favorites.toggle(loft);
    http.expectNone(() => true);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('forgets this session’s taps when the account changes', () => {
    setup();
    favorites.toggle(loft);
    favReq(loft.id).flush({ property: 5, is_favorite: true, saved_at: '' });
    expect(favorites.isSaved(loft)).toBe(true);
    auth.logout();
    TestBed.tick();
    expect(favorites.isSaved(loft)).toBe(false); // back to the card's own flag
  });

  it('list() gets the saved places, with ?page= after the first page', () => {
    setup();
    favorites.list().subscribe();
    expect(http.expectOne(FAVORITES_URL).request.params.keys()).toEqual([]);
    favorites.list(2).subscribe();
    http.expectOne((r) => r.url === FAVORITES_URL && r.params.get('page') === '2').flush({ count: 0, next: null, previous: null, results: [] });
  });

  it('toggle() reports the new state, or null when nothing changed', () => {
    setup();
    expect(favorites.toggle(loft)).toBe(true);
    expect(favorites.toggle(loft)).toBeNull(); // busy
    favReq(loft.id).flush({ property: 5, is_favorite: true, saved_at: '' });
    expect(favorites.toggle(loft)).toBe(false);
    favReq(loft.id).flush(null, { status: 204, statusText: 'No Content' });
  });
});
