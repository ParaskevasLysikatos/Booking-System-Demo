import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ADMIN_REVIEWS_URL, AdminReviewsService, toAdminReviewParams } from './admin-reviews.service';

describe('AdminReviewsService', () => {
  it('maps the filters to API params, leaving out defaults', () => {
    expect(toAdminReviewParams({ visibility: 'hidden', rating: 1, property: 7, search: ' noisy ', page: 2 }).toString()).toBe(
      'hidden=true&rating=1&property=7&search=noisy&page=2',
    );
    expect(toAdminReviewParams({ visibility: 'visible' }).toString()).toBe('hidden=false');
    expect(toAdminReviewParams({ visibility: 'all', rating: null, property: null, search: ' ', page: 1 }).toString()).toBe('');
  });

  it('hides / shows a review with a PATCH of is_hidden only', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    TestBed.inject(AdminReviewsService).setHidden(4, true).subscribe();
    const req = TestBed.inject(HttpTestingController).expectOne(`${ADMIN_REVIEWS_URL}4/`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ is_hidden: true });
    req.flush({});
  });
});
