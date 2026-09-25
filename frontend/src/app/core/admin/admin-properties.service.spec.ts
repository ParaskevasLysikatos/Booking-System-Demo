import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { PROPERTIES_URL } from '../properties/property.service';
import { AdminPropertiesService, PropertyWrite } from './admin-properties.service';

describe('AdminPropertiesService', () => {
  let api: AdminPropertiesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(AdminPropertiesService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  const listParams = () => http.expectOne((r) => r.url === PROPERTIES_URL && r.method === 'GET').request.params.toString();

  it('lists everything by default (no forced is_active), with status/search/sort/page', () => {
    api.list().subscribe();
    expect(listParams()).toBe('');
    api.list({ status: 'retired', search: ' corfu ', ordering: '-price', page: 2, pageSize: 12 }).subscribe();
    expect(listParams()).toBe('is_active=false&search=corfu&ordering=-price&page=2&page_size=12');
    api.list({ status: 'active', ordering: 'newest' }).subscribe();
    expect(listParams()).toBe('is_active=true');
  });

  it('create/update/retire/reactivate hit the right verbs', () => {
    const body = { title: 'X' } as PropertyWrite;
    api.create(body).subscribe();
    expect(http.expectOne({ url: PROPERTIES_URL, method: 'POST' }).request.body).toBe(body);
    api.update(5, { price_per_night: '90.00' }).subscribe();
    expect(http.expectOne({ url: `${PROPERTIES_URL}5/`, method: 'PATCH' }).request.body).toEqual({ price_per_night: '90.00' });
    api.retire(5).subscribe();
    http.expectOne({ url: `${PROPERTIES_URL}5/`, method: 'DELETE' });
    api.reactivate(5).subscribe();
    expect(http.expectOne({ url: `${PROPERTIES_URL}5/`, method: 'PATCH' }).request.body).toEqual({ is_active: true });
  });
});
