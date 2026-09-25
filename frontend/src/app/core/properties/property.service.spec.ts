import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { PROPERTIES_URL, PropertyService, toPropertyParams } from './property.service';

describe('PropertyService', () => {
  it('builds API params and leaves out empty values/defaults', () => {
    const params = toPropertyParams(
      {
        location: '  Chania ',
        guests: 2,
        minPrice: 0,
        maxPrice: 150,
        checkIn: new Date(2026, 10, 2),
        checkOut: new Date(2026, 10, 7),
        ordering: 'price',
      },
      { page: 2, pageSize: 24 },
    );
    expect(params.toString()).toBe(
      'location=Chania&guests=2&min_price=0&max_price=150&check_in=2026-11-02&check_out=2026-11-07&ordering=price&page=2&page_size=24',
    );
    expect(toPropertyParams({ ordering: 'newest', location: ' ' }, { page: 1, pageSize: 12 }).toString()).toBe('');
    // a lone date is never sent
    expect(toPropertyParams({ checkIn: new Date(2026, 10, 2) }).toString()).toBe('');
  });

  it('always asks for active properties only', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    TestBed.inject(PropertyService).list({ guests: 2 }, { page: 1, pageSize: 12 }).subscribe();
    const req = TestBed.inject(HttpTestingController).expectOne((r) => r.url === PROPERTIES_URL);
    expect(req.request.params.get('is_active')).toBe('true');
    expect(req.request.params.get('guests')).toBe('2');
    req.flush({ count: 0, next: null, previous: null, results: [] });
  });
});
