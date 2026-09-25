import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PropertySummary } from '../../../core/properties/property.models';
import { amenityLabel } from '../../../core/amenities';
import { PropertyCardComponent } from './property-card';

const property: PropertySummary = {
  id: 5, title: 'Harbour Loft', location: 'Chania, Greece', price_per_night: '91.00', capacity: 3,
  amenities: ['wifi', 'sea_view', 'air_conditioning', 'tv', 'pool'], is_active: true,
  cover_image: 'https://img.test/5.jpg', rating_avg: 4.5, review_count: 2,
};

describe('PropertyCardComponent', () => {
  function render(overrides: Partial<PropertySummary> = {}, nights: number | null = null) {
    TestBed.configureTestingModule({ imports: [PropertyCardComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(PropertyCardComponent);
    fixture.componentRef.setInput('property', { ...property, ...overrides });
    fixture.componentRef.setInput('nights', nights);
    fixture.componentRef.setInput('linkParams', { check_in: '2026-11-02', check_out: '2026-11-07', guests: 2 });
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('labels amenities nicely', () => {
    expect(amenityLabel('sea_view')).toBe('Sea view');
    expect(amenityLabel('wifi')).toBe('Wi-Fi');
    expect(amenityLabel('air_conditioning')).toBe('Air conditioning');
  });

  it('shows price, rating, first 3 amenities and links to the detail page with the search', () => {
    const el = render();
    const text = el.textContent!.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ');
    expect(el.querySelector('.price')!.textContent!.replace(/\u00a0/g, ' ').trim()).toBe('€91 / night');
    expect(el.querySelector('.rating')!.textContent!.replace(/\s+/g, ' ')).toContain('4.5 (2)');
    expect([...el.querySelectorAll('.chips li')].map((li) => li.textContent!.trim())).toEqual([
      'Wi-Fi', 'Sea view', 'Air conditioning', '+2',
    ]);
    expect(text).not.toContain(' for ');
    expect(el.querySelector('a')!.getAttribute('href')).toBe('/listings/5?check_in=2026-11-02&check_out=2026-11-07&guests=2');
  });

  it('shows the stay total when dates are picked, and "New" without reviews', () => {
    const text = render({ rating_avg: null, review_count: 0 }, 5).textContent!;
    expect(text).toContain('€455 for 5 nights');
    expect(text).toContain('New');
  });

  it('falls back to a placeholder when there is no photo', () => {
    const el = render({ cover_image: null });
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.no-photo')).not.toBeNull();
  });
});
