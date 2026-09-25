import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { BOOKINGS_URL, BookingService } from './booking.service';

describe('BookingService', () => {
  it('POSTs only what the server needs, and gets by id', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const service = TestBed.inject(BookingService);
    const http = TestBed.inject(HttpTestingController);

    service.create({ property: 3, check_in: '2027-02-02', check_out: '2027-02-04', guests: 2 }).subscribe();
    const post = http.expectOne(BOOKINGS_URL);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ property: 3, check_in: '2027-02-02', check_out: '2027-02-04', guests: 2 });

    service.get(41).subscribe();
    expect(http.expectOne(`${BOOKINGS_URL}41/`).request.method).toBe('GET');
  });

  it('lists with filters (comma statuses, mine) and cancels via PATCH', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const service = TestBed.inject(BookingService);
    const http = TestBed.inject(HttpTestingController);

    service.list({ when: 'upcoming', statuses: ['pending', 'confirmed'], mine: true, page: 2 }).subscribe();
    const list = http.expectOne((r) => r.url === BOOKINGS_URL);
    expect(list.request.params.toString()).toBe('when=upcoming&status=pending,confirmed&mine=true&page=2');

    service.cancel(41).subscribe();
    const patch = http.expectOne(`${BOOKINGS_URL}41/`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ status: 'cancelled' });
  });
});
