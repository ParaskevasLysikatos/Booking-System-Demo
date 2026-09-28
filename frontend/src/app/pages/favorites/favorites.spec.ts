import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject } from 'rxjs';

import { FAVORITES_URL, SavedProperty } from '../../core/favorites/favorite.service';
import { FavoritesPage, UNDO_MS } from './favorites';

const saved = (id: number, overrides: Partial<SavedProperty> = {}): SavedProperty => ({
  id,
  title: `Place ${id}`,
  location: 'Chania, Greece',
  price_per_night: '90.00',
  capacity: 2,
  amenities: ['wifi'],
  is_active: true,
  cover_image: null,
  rating_avg: null,
  review_count: 0,
  is_favorite: true,
  saved_at: '2026-09-28T17:00:00+03:00',
  ...overrides,
});
const page = (results: SavedProperty[], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});

/** A stand-in for MatSnackBarRef: the test decides when Undo is clicked / the bar goes away. */
function fakeSnack() {
  const action = new Subject<void>();
  const dismissed = new Subject<void>();
  const open = vi.fn(() => ({ onAction: () => action, afterDismissed: () => dismissed }));
  return {
    open,
    undo: () => action.next(),
    dismiss: () => {
      dismissed.next();
      dismissed.complete();
    },
  };
}

describe('FavoritesPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let snack: ReturnType<typeof fakeSnack>;

  async function open(url = '/favorites') {
    localStorage.clear();
    localStorage.setItem(
      'bsd.user',
      JSON.stringify({ id: 7, email: 'g@example.com', role: 'guest' }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'favorites', component: FavoritesPage }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    snack = fakeSnack();
    vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockImplementation(snack.open as never);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, FavoritesPage);
  }

  const el = () => harness.routeNativeElement as HTMLElement;
  const text = () => el().textContent!.replace(/\s+/g, ' ');
  const titles = () =>
    [...el().querySelectorAll('app-property-card .title')].map((t) => t.textContent!.trim());
  const listReq = (p?: number) =>
    http.expectOne(
      (r) =>
        r.url === FAVORITES_URL && (p ? r.params.get('page') === String(p) : !r.params.has('page')),
    );
  const heart = (i: number) =>
    el().querySelectorAll<HTMLButtonElement>('app-property-card app-favorite-button button')[i];

  async function settle() {
    harness.detectChanges();
    await harness.fixture.whenStable();
  }

  afterEach(() => http.verify());

  it('shows a skeleton, then the saved places newest first with the count', async () => {
    await open();
    expect(el().querySelector('[aria-busy="true"]')).not.toBeNull();
    listReq().flush(page([saved(3), saved(1), saved(2)]));
    await settle();
    expect(titles()).toEqual(['Place 3', 'Place 1', 'Place 2']);
    expect(text()).toContain('3 saved places');
    expect(heart(0).getAttribute('aria-pressed')).toBe('true');
    expect(el().querySelector('app-property-card a')!.getAttribute('href')).toBe('/listings/3');
    expect(el().querySelector('mat-paginator')).toBeNull();
  });

  it('empty: explains how to save and links to the stays', async () => {
    await open();
    listReq().flush(page([]));
    await settle();
    expect(text()).toContain('No saved places yet.');
    expect(text()).toContain('Tap the heart on any stay to save it here.');
    expect(el().querySelector('.message a')!.getAttribute('href')).toBe('/listings');
  });

  it('error: Try again loads again', async () => {
    await open();
    listReq().flush({ detail: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(text()).toContain("Couldn't load your saved places.");
    el().querySelector<HTMLButtonElement>('.message button')!.click();
    listReq().flush(page([saved(1)]));
    await settle();
    expect(titles()).toEqual(['Place 1']);
  });

  it('un-hearting removes the card at once with Undo; Undo saves it again in the same spot', async () => {
    await open();
    listReq().flush(page([saved(3), saved(1), saved(2)]));
    await settle();

    heart(1).click();
    await settle();
    expect(titles()).toEqual(['Place 3', 'Place 2']);
    expect(text()).toContain('2 saved places');
    expect(snack.open).toHaveBeenCalledWith('Removed “Place 1” from saved.', 'Undo', {
      duration: UNDO_MS,
    });
    const del = http.expectOne(`${FAVORITES_URL}1/`);
    expect(del.request.method).toBe('DELETE');
    del.flush(null, { status: 204, statusText: 'No Content' });

    snack.undo();
    await settle();
    const put = http.expectOne(`${FAVORITES_URL}1/`);
    expect(put.request.method).toBe('PUT');
    put.flush({ property: 1, is_favorite: true, saved_at: '' });
    await settle();
    expect(titles()).toEqual(['Place 3', 'Place 1', 'Place 2']);
    expect(text()).toContain('3 saved places');
  });

  it('if removing fails, the card comes back', async () => {
    await open();
    listReq().flush(page([saved(1), saved(2)]));
    await settle();
    heart(0).click();
    await settle();
    expect(titles()).toEqual(['Place 2']);
    http.expectOne(`${FAVORITES_URL}1/`).error(new ProgressEvent('error'), { status: 0 });
    await settle();
    expect(titles()).toEqual(['Place 1', 'Place 2']);
    expect(snack.open).toHaveBeenLastCalledWith(
      "Couldn’t remove this place. Can't reach the server. Check your connection and try again.",
      'OK',
      { duration: 6000 },
    );
  });

  it('a deactivated place is greyed out with Remove, and removing it has no Undo', async () => {
    await open();
    listReq().flush(page([saved(1, { is_active: false }), saved(2)]));
    await settle();
    expect(el().querySelectorAll('.card.unavailable').length).toBe(1);
    expect(text()).toContain('No longer available');
    el().querySelector<HTMLButtonElement>('button.remove')!.click();
    await settle();
    expect(titles()).toEqual(['Place 2']);
    expect(snack.open).toHaveBeenCalledWith('Removed “Place 1” from saved.', 'OK', {
      duration: UNDO_MS,
    });
    http.expectOne(`${FAVORITES_URL}1/`).flush(null, { status: 204, statusText: 'No Content' });
    expect(text()).toContain('1 saved place');
  });

  it('removing the only saved place shows the empty state (Undo still works)', async () => {
    await open();
    listReq().flush(page([saved(1)]));
    await settle();
    heart(0).click();
    await settle();
    http.expectOne(`${FAVORITES_URL}1/`).flush(null, { status: 204, statusText: 'No Content' });
    expect(text()).toContain('No saved places yet.');
    snack.undo();
    await settle();
    http.expectOne(`${FAVORITES_URL}1/`).flush({ property: 1, is_favorite: true, saved_at: '' });
    expect(titles()).toEqual(['Place 1']);
  });

  it('a page emptied here refills from the server once the Undo bar is gone', async () => {
    await open();
    listReq().flush(page([saved(1)], 5)); // more saved places than this page shows
    await settle();
    heart(0).click();
    await settle();
    http.expectOne(`${FAVORITES_URL}1/`).flush(null, { status: 204, statusText: 'No Content' });
    http.expectNone(FAVORITES_URL); // not while Undo is still possible
    snack.dismiss();
    await settle();
    listReq().flush(page([saved(4), saved(5)], 4));
    await settle();
    expect(titles()).toEqual(['Place 4', 'Place 5']);
  });

  it('pages of 12 in the URL; emptying the last page steps back one', async () => {
    await open('/favorites?page=2');
    listReq(2).flush(page([saved(13)], 13));
    await settle();
    expect(el().querySelector('mat-paginator')).not.toBeNull();
    heart(0).click();
    await settle();
    http.expectOne(`${FAVORITES_URL}13/`).flush(null, { status: 204, statusText: 'No Content' });
    snack.dismiss();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/favorites');
    listReq().flush(
      page(
        Array.from({ length: 12 }, (_, i) => saved(i + 1)),
        12,
      ),
    );
    await settle();
    expect(titles().length).toBe(12);
    expect(el().querySelector('mat-paginator')).toBeNull();
  });
});
