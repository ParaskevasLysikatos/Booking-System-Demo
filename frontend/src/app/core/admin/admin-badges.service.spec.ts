import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { BOOKINGS_URL } from '../bookings/booking.service';
import { AdminBadgesService } from './admin-badges.service';

describe('AdminBadgesService', () => {
  it('counts upcoming pending bookings (1-item page, uses the total count) and keeps it on errors', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const badges = TestBed.inject(AdminBadgesService);
    const http = TestBed.inject(HttpTestingController);

    badges.refresh();
    const req = http.expectOne((r) => r.url === BOOKINGS_URL);
    expect(req.request.params.toString()).toBe('when=upcoming&status=pending&page_size=1');
    req.flush({ count: 7, next: null, previous: null, results: [] });
    expect(badges.pendingBookings()).toBe(7);

    badges.refresh();
    http.expectOne((r) => r.url === BOOKINGS_URL).flush({}, { status: 500, statusText: 'Server Error' });
    expect(badges.pendingBookings()).toBe(7);
  });
});
