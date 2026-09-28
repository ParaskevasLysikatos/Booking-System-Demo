import { BreakpointObserver } from '@angular/cdk/layout';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';

import { MapPin, MapPins, PropertySummary } from '../../core/properties/property.models';
import { PROPERTIES_URL } from '../../core/properties/property.service';
import { MapComponent } from '../../shared/map/map';
import { MapLoader } from '../../shared/map/map-loader';
import { PropertyListPage } from './listings';

const card = (id: number, price = '80.00'): PropertySummary => ({
  id, title: `Stay ${id}`, location: 'Chania, Greece', price_per_night: price, capacity: 4,
  amenities: [], is_active: true, cover_image: null, rating_avg: null, review_count: 0,
});
const page = (count: number, results: PropertySummary[]) => ({ count, next: null, previous: null, results });
const pin = (id: number, price = '126.00'): MapPin => ({
  id, title: `Stay ${id}`, location: 'Chania, Greece', latitude: 35.51 + id / 1000, longitude: 24.02,
  location_is_approximate: true, location_radius_m: 500, price_per_night: price, capacity: 4,
  is_active: true, cover_image: null, rating_avg: null, review_count: 0, is_favorite: false,
});
const pins = (results: MapPin[], extra: Partial<MapPins> = {}): MapPins => ({
  count: results.length, missing_position: 0, truncated: false, results, ...extra,
});

describe('PropertyListPage - map (TICKET-034)', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;

  async function open(url: string, { wide }: { wide: boolean }): Promise<PropertyListPage> {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'listings', component: PropertyListPage }]),
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: wide, breakpoints: {} }) } },
        // The map itself is tested in shared/map; here it never finishes loading.
        { provide: MapLoader, useValue: { load: () => new Promise(() => undefined) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    window.scrollTo = vi.fn() as never;
    harness = await RouterTestingHarness.create();
    return harness.navigateByUrl(url, PropertyListPage);
  }

  const listCall = (): TestRequest => http.expectOne((r) => r.url === PROPERTIES_URL);
  const pinsCall = (): TestRequest => http.expectOne((r) => r.url === `${PROPERTIES_URL}map/`);
  const root = () => harness.routeNativeElement as HTMLElement;
  const text = () => root().textContent!.replace(/\s+/g, ' ');
  const map = (): MapComponent | undefined =>
    harness.fixture.debugElement.query(By.directive(MapComponent))?.componentInstance;
  const toggle = () => root().querySelector<HTMLButtonElement>('.view-toggle');

  afterEach(() => http.verify());

  describe('wide screens (split view)', () => {
    it('shows the list and the map side by side, with a price tag per matching stay', async () => {
      await open('/listings?location=chania&page=2', { wide: true });
      listCall().flush(page(20, [card(1), card(2)]));
      const req = pinsCall();
      expect(req.request.params.toString()).toBe('location=chania&is_active=true'); // no page
      req.flush(pins([pin(1), pin(2, '91.50'), pin(3)]));
      harness.detectChanges();

      expect(root().querySelector('.listings')!.classList).toContain('split');
      expect(root().querySelectorAll('app-property-card').length).toBe(2);
      expect(toggle()).toBeNull(); // no List/Map button
      const markers = map()!.markers();
      expect(markers.map((m) => m.label)).toEqual(['€126', '€91.50', '€126']);
      expect(markers[0]).toMatchObject({ id: 1, lat: pin(1).latitude, lng: 24.02, title: 'Stay 1, €126 a night' });
      expect(map()!.ariaLabel()).toBe('Map of the stays that match your search');
    });

    it('paging reloads the list but not the pins; a new search reloads both', async () => {
      const pageCmp = await open('/listings', { wide: true });
      listCall().flush(page(30, Array.from({ length: 12 }, (_, i) => card(i + 1))));
      pinsCall().flush(pins([pin(1)]));
      pageCmp.onPage({ pageIndex: 1, pageSize: 12, length: 30, previousPageIndex: 0 });
      await harness.fixture.whenStable();
      listCall().flush(page(30, []));
      http.expectNone((r) => r.url === `${PROPERTIES_URL}map/`);

      pageCmp.form.patchValue({ location: 'Volos' });
      pageCmp.search();
      await harness.fixture.whenStable();
      listCall().flush(page(0, []));
      expect(pinsCall().request.params.get('location')).toBe('Volos');
    });

    it('hovering or focusing a card lifts its price tag', async () => {
      await open('/listings', { wide: true });
      listCall().flush(page(2, [card(1), card(2)]));
      pinsCall().flush(pins([pin(1), pin(2)]));
      harness.detectChanges();
      const second = root().querySelectorAll('app-property-card')[1];
      second.dispatchEvent(new Event('mouseenter'));
      harness.detectChanges();
      expect(map()!.highlightedId()).toBe(2);
      second.dispatchEvent(new Event('mouseleave'));
      harness.detectChanges();
      expect(map()!.highlightedId()).toBeNull();
      second.dispatchEvent(new FocusEvent('focusin'));
      harness.detectChanges();
      expect(map()!.highlightedId()).toBe(2);
    });

    it("says how many stays aren't on the map, and when the pins were cut off", async () => {
      await open('/listings', { wide: true });
      listCall().flush(page(4, [card(1)]));
      pinsCall().flush(pins([pin(1), pin(2)], { missing_position: 2, truncated: true }));
      harness.detectChanges();
      expect(text()).toContain("2 stays aren't on the map (no location set yet).");
      expect(text()).toContain('Showing the first 2 stays - narrow the search to see the rest.');
    });

    it('keeps the old pins while new ones load, and offers Try again if they fail', async () => {
      const pageCmp = await open('/listings', { wide: true });
      listCall().flush(page(1, [card(1)]));
      pinsCall().flush(pins([pin(1)]));
      pageCmp.form.patchValue({ location: 'Volos' });
      pageCmp.search();
      await harness.fixture.whenStable();
      listCall().flush(page(0, []));
      harness.detectChanges();
      expect(pageCmp.pins().status).toBe('loading');
      expect(map()!.markers().map((m) => m.id)).toEqual([1]); // not emptied while loading
      expect(root().querySelector('mat-progress-bar')).not.toBeNull();

      pinsCall().flush({}, { status: 500, statusText: 'Server Error' });
      harness.detectChanges();
      expect(text()).toContain("Couldn't load the map's stays.");
      const retry = [...root().querySelectorAll<HTMLButtonElement>('.map-note button')].find((b) => b.textContent!.includes('Try again'))!;
      retry.click();
      pinsCall().flush(pins([pin(4)]));
      harness.detectChanges();
      expect(map()!.markers().map((m) => m.id)).toEqual([4]);
      expect(text()).not.toContain("Couldn't load the map's stays.");
    });

    it('ignores ?view=map (both are already shown)', async () => {
      await open('/listings?view=map', { wide: true });
      listCall().flush(page(1, [card(1)]));
      pinsCall().flush(pins([pin(1)]));
      harness.detectChanges();
      expect(root().querySelectorAll('app-property-card').length).toBe(1);
      expect(map()).toBeDefined();
    });
  });

  describe('phones and tablets (List / Map button)', () => {
    it('shows only the list, loads no pins, and offers Show map', async () => {
      await open('/listings', { wide: false });
      listCall().flush(page(1, [card(1)]));
      harness.detectChanges();
      expect(map()).toBeUndefined();
      http.expectNone((r) => r.url === `${PROPERTIES_URL}map/`);
      expect(toggle()!.textContent).toContain('Show map');
    });

    it('Show map puts ?view=map in the URL and swaps the list for the map, without reloading the list', async () => {
      await open('/listings?location=chania', { wide: false });
      listCall().flush(page(3, [card(1), card(2), card(3)]));
      harness.detectChanges();
      toggle()!.click();
      await harness.fixture.whenStable();
      expect(router.url).toBe('/listings?location=chania&view=map');
      http.expectNone((r) => r.url === PROPERTIES_URL); // the list isn't fetched again
      pinsCall().flush(pins([pin(1), pin(2), pin(3)]));
      harness.detectChanges();
      expect(root().querySelector('.listings')!.classList).toContain('map-only');
      expect(root().querySelectorAll('app-property-card').length).toBe(0);
      expect(text()).toContain('3 stays'); // the count stays visible
      expect(map()!.markers().length).toBe(3);
      expect(toggle()!.textContent).toContain('Show list');

      toggle()!.click();
      await harness.fixture.whenStable();
      expect(router.url).toBe('/listings?location=chania');
      harness.detectChanges();
      expect(map()).toBeUndefined();
      expect(root().querySelectorAll('app-property-card').length).toBe(3);
    });

    it('a new search keeps the map view', async () => {
      const pageCmp = await open('/listings?view=map', { wide: false });
      listCall().flush(page(0, []));
      pinsCall().flush(pins([]));
      pageCmp.form.patchValue({ location: 'Corfu' });
      pageCmp.search();
      await harness.fixture.whenStable();
      expect(router.url).toBe('/listings?location=Corfu&view=map');
      listCall().flush(page(0, []));
      pinsCall().flush(pins([]));
    });
  });
});
