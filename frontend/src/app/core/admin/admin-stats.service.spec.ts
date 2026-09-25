import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ADMIN_STATS_URL, AdminStatsService } from './admin-stats.service';

describe('AdminStatsService', () => {
  it('sends the period as local YYYY-MM-DD dates', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    TestBed.inject(AdminStatsService).getStats(new Date(2026, 8, 1), new Date(2026, 8, 30)).subscribe();
    const req = TestBed.inject(HttpTestingController).expectOne((r) => r.url === ADMIN_STATS_URL);
    expect(req.request.params.toString()).toBe('from=2026-09-01&to=2026-09-30');
  });
});
