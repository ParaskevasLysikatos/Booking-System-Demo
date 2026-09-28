import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { By } from '@angular/platform-browser';

import { GEOCODE_URL, GeocodeResult } from '../../../core/admin/geocode.service';
import { MapComponent } from '../../../shared/map/map';
import { MapLoader } from '../../../shared/map/map-loader';
import { LocationPickerComponent, MapPosition, roundCoord } from './location-picker';

@Component({
  imports: [ReactiveFormsModule, LocationPickerComponent],
  template: `<app-location-picker [formControl]="position" [locationText]="location()" />`,
})
class HostComponent {
  readonly position = new FormControl<MapPosition>(null, Validators.required);
  readonly location = signal('Chania, Greece');
}

const result = (over: Partial<GeocodeResult> = {}): GeocodeResult => ({
  label: '45, Tsimiski, Center, Thessaloniki, 546 23, Greece', name: '45',
  latitude: 40.632711, longitude: 22.943158, precision: 'address', kind: 'house', ...over,
});

describe('LocationPickerComponent (TICKET-034 step 7)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MapLoader, useValue: { load: () => new Promise(() => undefined) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent!.replace(/\s+/g, ' ');
  const input = () => el().querySelector<HTMLInputElement>('input')!;
  const findButton = () => [...el().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes('Find on map'))!;
  const picker = () => fixture.debugElement.query(By.directive(LocationPickerComponent)).componentInstance as LocationPickerComponent;
  const map = () => fixture.debugElement.query(By.directive(MapComponent)).componentInstance as MapComponent;
  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('starts empty with a hint, and the address box follows the Location field', async () => {
    await settle();
    expect(text()).toContain('Find the address, or click the map to place the pin.');
    expect(text()).toContain('No position yet.');
    expect(map().markers()).toEqual([]);
    expect(input().value).toBe('Chania, Greece');
    host.location.set('Volos, Greece');
    await settle();
    expect(input().value).toBe('Volos, Greece');
  });

  it('once typed in, the address box keeps its own text', async () => {
    input().value = 'Tsimiski 45, Thessaloniki';
    input().dispatchEvent(new Event('input'));
    host.location.set('Thessaloniki, Greece');
    await settle();
    expect(input().value).toBe('Tsimiski 45, Thessaloniki');
  });

  it('Find on map uses the best match straight away and says which place it picked', async () => {
    input().value = 'Tsimiski 45, Thessaloniki';
    input().dispatchEvent(new Event('input'));
    await settle();
    findButton().click();
    const req = http.expectOne((r) => r.url === GEOCODE_URL);
    expect(req.request.params.get('q')).toBe('Tsimiski 45, Thessaloniki');
    req.flush({ query: 'Tsimiski 45, Thessaloniki', attribution: '', results: [result(), result({ latitude: 1, longitude: 1, label: 'Second' })] });
    await settle();
    expect(host.position.value).toEqual({ lat: 40.632711, lng: 22.943158 });
    expect(host.position.dirty).toBe(true);
    expect(text()).toContain('Placed at 45, Tsimiski, Center, Thessaloniki, 546 23, Greece (exact address). Drag the pin to fine-tune.');
    expect(text()).toContain('40.632711, 22.943158');
    expect(map().fitToMarkers()).toBe(true); // jump to the found place
    expect(map().markers()).toEqual([
      { id: 'position', lat: 40.632711, lng: 22.943158, title: 'Map position (drag to move)', draggable: true },
    ]);
  });

  it('Enter in the address box searches too', async () => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    http.expectOne((r) => r.url === GEOCODE_URL).flush({ query: 'x', attribution: '', results: [result({ precision: 'city' })] });
    await settle();
    expect(text()).toContain('(town centre)');
  });

  it('nothing found: says so and leaves the position alone', async () => {
    host.position.setValue({ lat: 35.5, lng: 24 });
    findButton().click();
    http.expectOne((r) => r.url === GEOCODE_URL).flush({ query: 'Chania, Greece', attribution: '', results: [] });
    await settle();
    expect(text()).toContain('No place in Greece matched "Chania, Greece". Try a street and town, or click the map.');
    expect(host.position.value).toEqual({ lat: 35.5, lng: 24 });
  });

  it('shows the server message when the search is unavailable, and a friendly one when rate-limited', async () => {
    findButton().click();
    http.expectOne((r) => r.url === GEOCODE_URL).flush(
      { detail: "Map search isn't available right now. Try again in a moment, or place the pin on the map.", code: 'geocoding_unavailable' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await settle();
    expect(text()).toContain("Map search isn't available right now.");
    findButton().click();
    http.expectOne((r) => r.url === GEOCODE_URL).flush({ detail: 'Throttled' }, { status: 429, statusText: 'Too Many Requests' });
    await settle();
    expect(text()).toContain('Too many searches in a row - wait a minute, or click the map instead.');
    expect(host.position.value).toBeNull();
  });

  it('clicking the map places the pin (rounded to 6 decimals) without refitting', async () => {
    map().mapClick.emit({ lat: 39.366012345678, lng: 22.942087654321 });
    await settle();
    expect(host.position.value).toEqual({ lat: 39.366012, lng: 22.942088 });
    expect(host.position.touched).toBe(true);
    expect(map().fitToMarkers()).toBe(false); // the map stays where the admin is looking
    expect(text()).toContain('39.366012, 22.942088');
  });

  it('dragging the pin moves the position', async () => {
    host.position.setValue({ lat: 40, lng: 22 });
    await settle();
    expect(map().fitToMarkers()).toBe(true); // a loaded value is fitted
    map().markerDragEnd.emit({ marker: map().markers()[0], lat: 40.1234567, lng: 22.7654321 });
    await settle();
    expect(host.position.value).toEqual({ lat: 40.123457, lng: 22.765432 });
  });

  it('is required: an empty control is invalid', () => {
    expect(host.position.hasError('required')).toBe(true);
    picker().place({ lat: 1, lng: 2 }, false);
    expect(host.position.valid).toBe(true);
  });

  it('disabled: no search, no placing, pin not draggable', async () => {
    host.position.setValue({ lat: 40, lng: 22 });
    host.position.disable();
    await settle();
    expect(findButton().disabled).toBe(true);
    expect(map().markers()[0].draggable).toBe(false);
    picker().place({ lat: 1, lng: 1 }, false);
    expect(host.position.value).toEqual({ lat: 40, lng: 22 });
  });

  it('rounds coordinates to 6 decimals', () => {
    expect(roundCoord(40.1234565)).toBe(40.123457);
    expect(roundCoord(-22.0000004)).toBe(-22);
  });
});
