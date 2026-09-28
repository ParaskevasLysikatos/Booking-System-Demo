import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { PropertyDetail } from '../../../core/properties/property.models';
import { MapComponent } from '../../../shared/map/map';
import { MapLoader } from '../../../shared/map/map-loader';
import {
  PropertyLocationComponent,
  googleMapsAreaUrl,
  googleMapsPinUrl,
  googleMapsSearchUrl,
} from './property-location';

const base = {
  id: 42, title: 'Modern Room in Thessaloniki', location: 'Thessaloniki, Greece', price_per_night: '182.00',
  capacity: 2, amenities: [], is_active: true, cover_image: null, rating_avg: null, review_count: 0,
  description: '', images: [], availability: { booked_ranges: [] }, created_at: '', updated_at: '',
} as PropertyDetail;

const guestView: Partial<PropertyDetail> = {
  latitude: 40.635527, longitude: 22.955367, location_is_approximate: true, location_radius_m: 500,
};
const adminView: Partial<PropertyDetail> = {
  latitude: 40.6326, longitude: 22.941, location_is_approximate: false, location_radius_m: null,
};

describe('PropertyLocationComponent (TICKET-034)', () => {
  function render(extra: Partial<PropertyDetail>) {
    TestBed.configureTestingModule({
      imports: [PropertyLocationComponent],
      // The map itself is tested in shared/map; here it never finishes loading.
      providers: [{ provide: MapLoader, useValue: { load: () => new Promise(() => undefined) } }],
    });
    const fixture = TestBed.createComponent(PropertyLocationComponent);
    fixture.componentRef.setInput('property', { ...base, ...extra });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const map = fixture.debugElement.query(By.directive(MapComponent))?.componentInstance as MapComponent | undefined;
    const text = el.textContent!.replace(/\s+/g, ' ');
    const link = el.querySelector<HTMLAnchorElement>('a.gmaps')!;
    return { el, map, text, link };
  }

  it('guests: a 500 m circle (no pin), a privacy note and Google Maps showing the area', () => {
    const { map, text, link } = render(guestView);
    expect(map!.markers()).toEqual([
      { id: 42, lat: 40.635527, lng: 22.955367, title: 'Approximate area of Modern Room in Thessaloniki', areaRadiusM: 500 },
    ]);
    expect(map!.cluster()).toBe(false);
    expect(map!.scrollWheelZoom()).toBe(false); // scrolling the page never gets stuck in the map
    expect(map!.ariaLabel()).toBe('Map: the area around Modern Room in Thessaloniki');
    expect(text).toContain('Thessaloniki, Greece');
    expect(text).toContain("Shown within about 500 m to protect the host's privacy.");
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/@?api=1&map_action=map&center=40.635527,22.955367&zoom=15',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(text).toContain('Open in Google Maps (opens in a new tab)');
  });

  it('admins: the exact point as a pin, and Google Maps with a pin', () => {
    const { map, text, link } = render(adminView);
    expect(map!.markers()).toEqual([
      { id: 42, lat: 40.6326, lng: 22.941, title: 'Exact location of Modern Room in Thessaloniki' },
    ]);
    expect(map!.ariaLabel()).toBe('Map: exact location of Modern Room in Thessaloniki');
    expect(text).toContain('Exact location - only admins see this. Guests see a 500 m area.');
    expect(text).not.toContain('privacy');
    expect(link.getAttribute('href')).toBe('https://www.google.com/maps/search/?api=1&query=40.6326,22.941');
  });

  it('no position yet: no map, the location text and a Google Maps search for it', () => {
    const { map, text, link } = render({ latitude: null, longitude: null, location_is_approximate: true });
    expect(map).toBeUndefined();
    expect(text).toContain('Thessaloniki, Greece');
    expect(text).not.toContain('500 m');
    expect(link.getAttribute('href')).toBe('https://www.google.com/maps/search/?api=1&query=Thessaloniki%2C%20Greece');
  });

  it('builds Google Maps URLs', () => {
    expect(googleMapsAreaUrl(1.5, 2.25)).toBe('https://www.google.com/maps/@?api=1&map_action=map&center=1.5,2.25&zoom=15');
    expect(googleMapsPinUrl(1.5, 2.25)).toBe('https://www.google.com/maps/search/?api=1&query=1.5,2.25');
    expect(googleMapsSearchUrl('Chania & Co')).toBe('https://www.google.com/maps/search/?api=1&query=Chania%20%26%20Co');
  });
});
