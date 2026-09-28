import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { GEOCODE_URL, GeocodeService } from './geocode.service';

describe('GeocodeService (TICKET-034)', () => {
  it('asks the admin geocode endpoint with the trimmed text', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    let places = 0;
    TestBed.inject(GeocodeService).search('  Tsimiski 45, Thessaloniki ').subscribe((r) => (places = r.results.length));
    const req = TestBed.inject(HttpTestingController).expectOne((r) => r.url === GEOCODE_URL);
    expect(GEOCODE_URL).toMatch(/\/api\/admin\/geocode\/$/);
    expect(req.request.params.get('q')).toBe('Tsimiski 45, Thessaloniki');
    req.flush({ query: 'x', attribution: '', results: [{ label: 'a', name: 'a', latitude: 1, longitude: 2, precision: 'address', kind: 'house' }] });
    expect(places).toBe(1);
  });
});
