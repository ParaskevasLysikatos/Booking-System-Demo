import { Component, Injectable, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type * as Leaflet from 'leaflet';

import { MapComponent } from './map';
import { LeafletApi, MAP_STYLESHEET_HREF, MapLoader } from './map-loader';
import { GREECE_VIEW, MapMarker } from './map-markers';

/** The real Leaflet, without waiting for the stylesheet (jsdom never loads it). */
@Injectable()
class TestMapLoader extends MapLoader {
  static fail = false;
  protected override loadStylesheet(): Promise<void> {
    return Promise.resolve();
  }
  protected override loadOnce(): Promise<LeafletApi> {
    return TestMapLoader.fail ? Promise.reject(new Error('offline')) : super.loadOnce();
  }
}

const THESS: MapMarker = { id: 1, lat: 40.6326, lng: 22.941, title: 'Thess Loft, €60 a night', label: '€60' };
const THESS_2: MapMarker = { id: 2, lat: 40.6331, lng: 22.9415, title: 'Next door, €70 a night', label: '€70' };
const CHANIA: MapMarker = { id: 3, lat: 35.512, lng: 24.02, title: 'Chania Villa, €300 a night', label: '€300' };

@Component({
  imports: [MapComponent],
  template: `
    <app-map
      style="height: 400px"
      ariaLabel="Stays on a map"
      [markers]="markers()"
      [cluster]="cluster()"
      [highlightedId]="highlighted()"
      (markerSelect)="selected.push($event)"
      (mapClick)="clicks.push($event)"
    >
      <ng-template let-marker><a class="test-popup">{{ marker.title }}</a></ng-template>
    </app-map>
  `,
})
class HostComponent {
  readonly markers = signal<MapMarker[]>([THESS, CHANIA]);
  readonly cluster = signal(false);
  readonly highlighted = signal<number | null>(null);
  readonly selected: MapMarker[] = [];
  readonly clicks: { lat: number; lng: number }[] = [];
}

describe('MapComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

  // jsdom has no layout: give every element a size so Leaflet can fit bounds and cluster.
  const sizes: [string, number][] = [['clientWidth', 800], ['clientHeight', 400], ['offsetWidth', 800], ['offsetHeight', 400]];
  beforeAll(() => {
    for (const [prop, value] of sizes) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
    }
  });
  afterAll(() => {
    for (const [prop] of sizes) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  });

  function mapCmp(): MapComponent {
    return fixture.debugElement.children[0].componentInstance as MapComponent;
  }

  function leaflet(): Leaflet.Map {
    return mapCmp().leafletMap!;
  }

  async function ready(): Promise<void> {
    await vi.waitFor(() => expect(mapCmp().status()).toBe('ready'), { timeout: 5000 });
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function priceTags(): string[] {
    return Array.from(el.querySelectorAll('.app-map-price')).map((e) => e.textContent ?? '');
  }

  beforeEach(async () => {
    TestMapLoader.fail = false;
    TestBed.configureTestingModule({ providers: [{ provide: MapLoader, useClass: TestMapLoader }] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('shows a spinner, then the map as a labelled region', async () => {
    expect(el.querySelector('mat-spinner')).not.toBeNull();
    await ready();
    expect(el.querySelector('mat-spinner')).toBeNull();
    expect(el.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Stays on a map');
    expect(el.querySelector('.leaflet-container')).not.toBeNull();
  });

  it('uses CARTO Voyager tiles with OpenStreetMap + CARTO credits', async () => {
    await ready();
    let tiles: Leaflet.TileLayer | undefined;
    leaflet().eachLayer((l) => {
      if ((l as Leaflet.TileLayer).getTileUrl) tiles = l as Leaflet.TileLayer;
    });
    expect((tiles as unknown as { _url: string })._url).toContain('basemaps.cartocdn.com/rastertiles/voyager');
    const credits = el.querySelector('.leaflet-control-attribution')?.textContent ?? '';
    expect(credits).toContain('OpenStreetMap');
    expect(credits).toContain('CARTO');
  });

  it('draws a keyboard-reachable price tag per marker', async () => {
    await ready();
    expect(priceTags().sort()).toEqual(['€300', '€60']);
    const icon = el.querySelector<HTMLElement>('.app-map-marker[title="Thess Loft, €60 a night"]')!;
    expect(icon.getAttribute('role')).toBe('button');
    expect(icon.tabIndex).toBe(0);
    expect(icon.getAttribute('aria-label')).toBe('Thess Loft, €60 a night');
  });

  it('draws a round pin when a marker has no label', async () => {
    host.markers.set([{ id: 9, lat: 40.6, lng: 22.9, title: 'Here' }]);
    await ready();
    expect(el.querySelectorAll('.app-map-pin').length).toBe(1);
  });

  it('skips markers without a position', async () => {
    host.markers.set([THESS, { id: 7, lat: null as unknown as number, lng: null as unknown as number, title: 'Nowhere' }]);
    await ready();
    expect(priceTags()).toEqual(['€60']);
  });

  it('fits all markers, one marker at street level, none to Greece', async () => {
    await ready();
    const bounds = leaflet().getBounds();
    expect(bounds.contains([THESS.lat, THESS.lng])).toBe(true);
    expect(bounds.contains([CHANIA.lat, CHANIA.lng])).toBe(true);

    host.markers.set([THESS]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(leaflet().getZoom()).toBe(15);
    expect(leaflet().getCenter().lat).toBeCloseTo(THESS.lat, 3);

    host.markers.set([]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(leaflet().getZoom()).toBe(GREECE_VIEW.zoom);
    expect(priceTags()).toEqual([]);
  });

  it('draws a shaded circle, not a marker, for an approximate area', async () => {
    host.markers.set([{ id: 5, lat: 35.512, lng: 24.02, title: 'Approximate location', areaRadiusM: 500 }]);
    await ready();
    const circles: Leaflet.Circle[] = [];
    leaflet().eachLayer((l) => {
      if ((l as Leaflet.Circle).getRadius) circles.push(l as Leaflet.Circle);
    });
    expect(circles.length).toBe(1);
    expect(circles[0].getRadius()).toBe(500);
    expect(el.querySelectorAll('.app-map-marker').length).toBe(0);
    // the whole circle is in view
    const view = leaflet().getBounds();
    expect(view.contains(circles[0].getLatLng().toBounds(1000))).toBe(true);
  });

  it('clusters nearby markers into a labelled bubble', async () => {
    host.cluster.set(true);
    host.markers.set([THESS, THESS_2, CHANIA]);
    await ready();
    leaflet().setView([38, 23.5], 5);
    await vi.waitFor(() => expect(el.querySelector('.app-map-cluster-icon')).not.toBeNull());
    await new Promise((r) => setTimeout(r));
    const bubble = el.querySelector<HTMLElement>('.app-map-cluster-icon')!;
    expect(bubble.textContent?.trim()).toBe('2');
    expect(bubble.getAttribute('aria-label')).toBe('2 stays here - zoom in');
    expect(bubble.getAttribute('role')).toBe('button');
    expect(priceTags()).toEqual(['€300']);
  });

  it('highlights a marker, or the bubble it is in', async () => {
    await ready();
    host.highlighted.set(1);
    fixture.detectChanges();
    await fixture.whenStable();
    const tag = () => el.querySelector('.app-map-marker[title^="Thess Loft"]')!;
    expect(tag().classList).toContain('is-highlighted');
    host.highlighted.set(null);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(tag().classList).not.toContain('is-highlighted');

    host.cluster.set(true);
    host.markers.set([THESS, THESS_2, CHANIA]);
    host.highlighted.set(2);
    fixture.detectChanges();
    await fixture.whenStable();
    leaflet().setView([38, 23.5], 5);
    await vi.waitFor(() => expect(el.querySelector('.app-map-cluster-icon.is-highlighted')).not.toBeNull());
  });

  it('emits markerSelect and opens the pop-up template on click', async () => {
    await ready();
    const icon = el.querySelector<HTMLElement>('.app-map-marker[title^="Thess Loft"]')!;
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(host.selected.map((m) => m.id)).toEqual([1]);
    const popup = el.querySelector('.app-map-popup .test-popup');
    expect(popup?.textContent).toBe('Thess Loft, €60 a night');

    leaflet().closePopup();
    expect(el.querySelector('.test-popup')).toBeNull();
  });

  it('closes an open pop-up when the markers change', async () => {
    await ready();
    el.querySelector<HTMLElement>('.app-map-marker')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.querySelector('.test-popup')).not.toBeNull();
    host.markers.set([CHANIA]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('.test-popup')).toBeNull();
    expect(priceTags()).toEqual(['€300']);
  });

  it('emits mapClick with the clicked point', async () => {
    await ready();
    const L = (globalThis as unknown as { L: LeafletApi }).L;
    leaflet().fire('click', { latlng: L.latLng(39.1, 22.2) });
    expect(host.clicks).toEqual([{ lat: 39.1, lng: 22.2 }]);
  });

  it('shows an error with Try again when the map code fails to load', async () => {
    fixture.destroy();
    TestBed.resetTestingModule(); // a fresh MapLoader (the old one cached its success)
    TestBed.configureTestingModule({ providers: [{ provide: MapLoader, useClass: TestMapLoader }] });
    TestMapLoader.fail = true;
    fixture = TestBed.createComponent(HostComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
    await vi.waitFor(() => expect(mapCmp().status()).toBe('error'));
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("The map couldn't load.");

    TestMapLoader.fail = false;
    el.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    await ready();
    expect(priceTags().length).toBe(2);
  });

  it('removes the Leaflet map when destroyed', async () => {
    await ready();
    const map = leaflet();
    const remove = vi.spyOn(map, 'remove');
    fixture.destroy();
    expect(remove).toHaveBeenCalled();
  });
});

describe('MapLoader', () => {
  it('adds the lazy map stylesheet once and loads Leaflet + clusters once', async () => {
    const loader = TestBed.inject(MapLoader);
    const done = loader.load();
    const link = document.head.querySelector<HTMLLinkElement>('link[data-map-styles]')!;
    expect(link.getAttribute('href')).toBe(MAP_STYLESHEET_HREF);
    link.dispatchEvent(new Event('load'));
    const L = await done;
    expect(typeof L.map).toBe('function');
    expect(typeof L.markerClusterGroup).toBe('function');
    expect(loader.load()).toBe(loader.load());
    expect(await loader.load()).toBe(L);
    expect(document.head.querySelectorAll('link[data-map-styles]').length).toBe(1);
    link.remove();
  });

  it('forgets a failed load so it can be retried', async () => {
    @Injectable()
    class FlakyLoader extends MapLoader {
      calls = 0;
      protected override loadOnce(): Promise<LeafletApi> {
        this.calls++;
        return this.calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({} as LeafletApi);
      }
    }
    TestBed.configureTestingModule({ providers: [{ provide: MapLoader, useClass: FlakyLoader }] });
    const loader = TestBed.inject(MapLoader) as FlakyLoader;
    await expect(loader.load()).rejects.toThrow('offline');
    await expect(loader.load()).resolves.toEqual({});
    expect(loader.calls).toBe(2);
  });
});
