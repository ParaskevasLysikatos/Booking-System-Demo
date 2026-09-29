import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';

import { PropertySummary } from '../../../core/properties/property.models';
import { PROPERTIES_URL } from '../../../core/properties/property.service';
import { AdminPropertyListPage } from './admin-property-list';
import { TranslationService } from '../../../core/i18n/translation.service';

const prop = (id: number, overrides: Partial<PropertySummary> = {}): PropertySummary => ({
  id, title: `Stay ${id}`, location: 'Corfu, Greece', price_per_night: '80.00', capacity: 4, amenities: [],
  is_active: true, cover_image: null, rating_avg: null, review_count: 0, ...overrides,
});
const page = (results: PropertySummary[], count = results.length) => ({ count, next: null, previous: null, results });

describe('AdminPropertyListPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;
  let answer: boolean;
  let snack: ReturnType<typeof vi.fn>;

  async function open(url = '/admin/properties') {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: 'admin/properties', component: AdminPropertyListPage }])],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    answer = true;
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockImplementation(() => ({ afterClosed: () => of(answer) }) as never);
    snack = vi.fn();
    vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockImplementation(snack as never);
    harness = await RouterTestingHarness.create();
    return harness.navigateByUrl(url, AdminPropertyListPage);
  }

  const listReq = (): TestRequest => http.expectOne((r) => r.url === PROPERTIES_URL && r.method === 'GET');
  const text = () => (harness.routeNativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');

  afterEach(() => http.verify());

  it('lists all properties (active + retired) with status chips', async () => {
    await open();
    const req = listReq();
    expect(req.request.params.toString()).toBe('page_size=12');
    req.flush(page([prop(1, { title: 'Harbour Loft' }), prop(2, { title: 'Old Mill', is_active: false })]));
    harness.detectChanges();
    expect(text()).toContain('2 properties');
    expect(text()).toContain('Harbour Loft');
    expect(text()).toContain('Retired');
  });

  it('shows how many guests saved each place (TICKET-033), also in the phone card line', async () => {
    await open();
    listReq().flush(page([prop(1, { title: 'Harbour Loft', favorite_count: 3 }), prop(2, { title: 'Old Mill', favorite_count: 1 }), prop(3, { title: 'New Barn' })]));
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    expect([...el.querySelectorAll('th')].map((t) => t.textContent!.trim())).toContain('Saved by');
    const cells = [...el.querySelectorAll('td.saved')];
    expect(cells.map((c) => c.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['favorite3', 'favorite1', 'favorite_border0']);
    expect(cells.map((c) => c.getAttribute('aria-label'))).toEqual(['Saved by 3 guests', 'Saved by 1 guest', 'Saved by 0 guests']);
    expect(cells[2].classList).toContain('none');
    expect(el.querySelector('.card-meta')!.textContent).toContain('· Saved by 3 guests');
  });

  it('status, sort and search go through the URL', async () => {
    const pageCmp = await open('/admin/properties?status=retired&search=mill&ordering=-price');
    expect(listReq().request.params.toString()).toBe('is_active=false&search=mill&ordering=-price&page_size=12');
    expect(pageCmp.search.value).toBe('mill');

    pageCmp.setStatus('active');
    await harness.fixture.whenStable();
    expect(router.url).toBe('/admin/properties?status=active&search=mill&ordering=-price');
    listReq().flush(page([]));

    pageCmp.search.setValue('corfu');
    await new Promise((r) => setTimeout(r, 350)); // debounce
    await harness.fixture.whenStable();
    expect(router.url).toBe('/admin/properties?status=active&search=corfu&ordering=-price');
    listReq().flush(page([]));
  });

  it('retire asks first, then DELETEs (soft), shows a snackbar and refreshes', async () => {
    const pageCmp = await open();
    listReq().flush(page([prop(5, { title: 'Harbour Loft' })]));
    pageCmp.retire(prop(5, { title: 'Harbour Loft' }));
    http.expectOne({ url: `${PROPERTIES_URL}5/`, method: 'DELETE' }).flush(null, { status: 204, statusText: 'No Content' });
    expect(snack.mock.calls[0][0]).toBe('"Harbour Loft" retired - hidden from guests.');
    listReq().flush(page([prop(5, { is_active: false })]));
  });

  it('declining the retire dialog does nothing', async () => {
    const pageCmp = await open();
    listReq().flush(page([prop(5)]));
    answer = false;
    pageCmp.retire(prop(5));
    http.expectNone({ url: `${PROPERTIES_URL}5/`, method: 'DELETE' });
  });

  it('reactivate PATCHes is_active=true', async () => {
    const pageCmp = await open();
    listReq().flush(page([prop(5, { is_active: false })]));
    pageCmp.reactivate(prop(5, { title: 'Old Mill', is_active: false }));
    const req = http.expectOne({ url: `${PROPERTIES_URL}5/`, method: 'PATCH' });
    expect(req.request.body).toEqual({ is_active: true });
    req.flush(prop(5));
    expect(snack.mock.calls[0][0]).toBe('"Old Mill" is active again.');
    listReq().flush(page([prop(5)]));
  });

  it('empty and error states', async () => {
    const pageCmp = await open();
    listReq().flush({}, { status: 500, statusText: 'Server Error' });
    harness.detectChanges();
    expect(text()).toContain("Couldn't load the properties.");
    pageCmp.retry();
    listReq().flush(page([]));
    harness.detectChanges();
    expect(text()).toContain('No properties match.');
  });

  it('in Greek (TICKET-038): headings, chips, count and saved-by', async () => {
    await open();
    TestBed.inject(TranslationService).setLang('el');
    listReq().flush(page([prop(1, { title: 'Harbour Loft', favorite_count: 3 }), prop(2, { title: 'Old Mill', is_active: false })]));
    harness.detectChanges();
    await harness.fixture.whenStable();
    const el = text().replace(/[\u00a0\u202f]/g, ' ');
    expect(el).toContain('Νέο κατάλυμα');
    expect(el).toContain('2 καταλύματα');
    expect(el).toContain('Αποσυρμένο');
    expect(el).toContain('Αποθηκεύτηκε από 3 επισκέπτες');
  });
});
