import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { PropertySummary } from '../../core/properties/property.models';
import { PROPERTIES_URL } from '../../core/properties/property.service';
import { PropertyListPage } from './listings';

const card = (id: number, price = '80.00'): PropertySummary => ({
  id, title: `Stay ${id}`, location: 'Chania, Greece', price_per_night: price, capacity: 4,
  amenities: [], is_active: true, cover_image: null, rating_avg: null, review_count: 0,
});
const page = (count: number, results: PropertySummary[]) => ({ count, next: null, previous: null, results });

describe('PropertyListPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;

  async function open(url: string): Promise<PropertyListPage> {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'listings', component: PropertyListPage }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    harness = await RouterTestingHarness.create();
    return harness.navigateByUrl(url, PropertyListPage);
  }

  const apiCall = (): TestRequest => http.expectOne((r) => r.url === PROPERTIES_URL);
  const text = () => (harness.routeNativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');

  afterEach(() => http.verify());

  it('reads the search from the URL, calls the API once, shows cards + stay totals', async () => {
    const pageCmp = await open('/listings?location=chania&guests=2&check_in=2026-11-02&check_out=2026-11-07');
    const req = apiCall();
    expect(req.request.params.toString()).toBe(
      'location=chania&guests=2&check_in=2026-11-02&check_out=2026-11-07&is_active=true',
    );
    expect(pageCmp.form.controls.location.value).toBe('chania'); // form filled from the URL
    req.flush(page(2, [card(1, '91.00'), card(2)]));
    harness.detectChanges();
    expect(text()).toContain('2 stays available for 5 nights');
    expect(text()).toContain('€455 for 5 nights');
  });

  it('Search puts the form into the URL and resets to page 1', async () => {
    const pageCmp = await open('/listings?page=3');
    apiCall().flush(page(40, []));
    pageCmp.form.patchValue({
      location: ' Corfu ', guests: 3,
      dates: { start: new Date(2026, 10, 2), end: new Date(2026, 10, 4) },
    });
    pageCmp.search();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/listings?location=Corfu&guests=3&check_in=2026-11-02&check_out=2026-11-04');
    apiCall().flush(page(0, []));
  });

  it('does not search with only one date', async () => {
    const pageCmp = await open('/listings');
    apiCall().flush(page(0, []));
    pageCmp.form.controls.dates.setValue({ start: new Date(2026, 10, 2), end: null });
    pageCmp.search();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/listings');
    expect(pageCmp.dateError()).toBe('Pick both a check-in and a check-out date.');
  });

  it('sorting applies immediately (no Search click needed)', async () => {
    const pageCmp = await open('/listings?location=chania');
    apiCall().flush(page(0, []));
    pageCmp.form.controls.location.setValue('typed but not searched');
    pageCmp.form.controls.ordering.setValue('-price');
    await harness.fixture.whenStable();
    expect(router.url).toBe('/listings?location=chania&ordering=-price'); // unsubmitted text is not applied
    apiCall().flush(page(0, []));
  });

  it('shows empty and error states', async () => {
    await open('/listings?location=atlantis');
    apiCall().flush(page(0, []));
    harness.detectChanges();
    expect(text()).toContain('No stays match your search.');
    expect(text()).toContain('Clear filters');
  });

  it('a 400 shows the (humanized) API message with Clear filters', async () => {
    await open('/listings?check_in=2020-01-01&check_out=2020-01-05');
    apiCall().flush({ check_in: ["check_in can't be in the past."] }, { status: 400, statusText: 'Bad Request' });
    harness.detectChanges();
    expect(text()).toContain("Check-in can't be in the past.");
    expect(text()).toContain('Clear filters');
    expect(text()).not.toContain('Try again');
  });

  it('a server error offers Try again, which re-requests', async () => {
    const pageCmp = await open('/listings');
    apiCall().flush({}, { status: 500, statusText: 'Server Error' });
    harness.detectChanges();
    expect(text()).toContain('Try again');
    pageCmp.retry();
    apiCall().flush(page(1, [card(1)]));
    harness.detectChanges();
    expect(text()).toContain('1 stay');
  });

  it('shows a paginator past one page, and paging updates the URL', async () => {
    const pageCmp = await open('/listings');
    apiCall().flush(page(30, Array.from({ length: 12 }, (_, i) => card(i + 1))));
    harness.detectChanges();
    expect(harness.routeNativeElement!.querySelector('mat-paginator')).not.toBeNull();
    window.scrollTo = vi.fn() as never;
    pageCmp.onPage({ pageIndex: 1, pageSize: 12, length: 30, previousPageIndex: 0 });
    await harness.fixture.whenStable();
    expect(router.url).toBe('/listings?page=2');
    apiCall().flush(page(30, []));
  });
});
