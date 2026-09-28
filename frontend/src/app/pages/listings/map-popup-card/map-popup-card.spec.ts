import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../../core/auth/auth.service';
import { MapPin } from '../../../core/properties/property.models';
import { MapPopupCardComponent } from './map-popup-card';

const pin: MapPin = {
  id: 14, title: 'Spacious Loft in Mykonos', location: 'Mykonos, Greece', latitude: 37.44, longitude: 25.33,
  location_is_approximate: true, location_radius_m: 500, price_per_night: '212.00', capacity: 4,
  is_active: true, cover_image: 'https://img.test/14.jpg', rating_avg: 4.5, review_count: 2, is_favorite: false,
};

describe('MapPopupCardComponent (TICKET-034)', () => {
  function render(overrides: Partial<MapPin> = {}, nights: number | null = null, admin = false) {
    TestBed.configureTestingModule({
      imports: [MapPopupCardComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    if (admin) vi.spyOn(TestBed.inject(AuthService), 'isAdmin').mockReturnValue(true);
    const fixture = TestBed.createComponent(MapPopupCardComponent);
    fixture.componentRef.setInput('pin', { ...pin, ...overrides });
    fixture.componentRef.setInput('nights', nights);
    fixture.componentRef.setInput('linkParams', { check_in: '2026-11-02', check_out: '2026-11-07', guests: 2 });
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const clean = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

  it('shows photo, title, rating, location and price, linking to the stay with the search', () => {
    const el = render();
    expect(el.querySelector('img')!.getAttribute('src')).toBe('https://img.test/14.jpg');
    expect(clean(el.querySelector('.title')!.textContent)).toBe('Spacious Loft in Mykonos');
    expect(clean(el.querySelector('.rating')!.textContent)).toContain('4.5 (2)');
    expect(clean(el.querySelector('.location')!.textContent)).toBe('Mykonos, Greece');
    expect(clean(el.querySelector('.price')!.textContent)).toBe('€212 / night');
    expect(el.querySelector('a.pop')!.getAttribute('href')).toBe(
      '/listings/14?check_in=2026-11-02&check_out=2026-11-07&guests=2',
    );
  });

  it('adds the stay total when dates are picked', () => {
    const el = render({}, 5);
    expect(clean(el.querySelector('.total')!.textContent)).toBe('€1,060 for 5 nights');
    TestBed.resetTestingModule();
    expect(clean(render({}, 1).querySelector('.total')!.textContent)).toBe('€212 for 1 night');
  });

  it('says New without reviews, and falls back when the photo is missing', () => {
    const el = render({ rating_avg: null, review_count: 0, cover_image: null });
    expect(clean(el.querySelector('.rating')!.textContent)).toBe('New');
    expect(el.querySelector('.rating')!.getAttribute('aria-label')).toBe('No reviews yet');
    expect(el.querySelector('.no-photo')).not.toBeNull();
  });

  it('has the heart for guests (outside the link), none for admins', () => {
    const el = render({ is_favorite: true });
    const heart = el.querySelector<HTMLButtonElement>('app-favorite-button button')!;
    expect(heart.getAttribute('aria-label')).toBe('Save Spacious Loft in Mykonos');
    expect(heart.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('a.pop app-favorite-button')).toBeNull();
    TestBed.resetTestingModule();
    expect(render({}, null, true).querySelector('app-favorite-button button')).toBeNull();
  });
});
