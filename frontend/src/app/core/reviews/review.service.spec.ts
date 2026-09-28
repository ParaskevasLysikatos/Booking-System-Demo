import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { PROPERTIES_URL } from '../properties/property.service';
import { ReviewService } from './review.service';

describe('ReviewService', () => {
  it("gets a property's reviews, sending ?page= only after page 1", () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const service = TestBed.inject(ReviewService);
    const http = TestBed.inject(HttpTestingController);

    service.forProperty(5).subscribe();
    const first = http.expectOne(`${PROPERTIES_URL}5/reviews/`);
    expect(first.request.params.keys()).toEqual([]);
    first.flush({});

    service.forProperty(5, 3).subscribe();
    const third = http.expectOne((r) => r.url === `${PROPERTIES_URL}5/reviews/`);
    expect(third.request.params.get('page')).toBe('3');
    third.flush({});
    http.verify();
  });
});
