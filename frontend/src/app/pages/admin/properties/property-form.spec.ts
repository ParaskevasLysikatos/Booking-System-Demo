import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { PropertyDetail } from '../../../core/properties/property.models';
import { PROPERTIES_URL } from '../../../core/properties/property.service';
import { MapLoader } from '../../../shared/map/map-loader';
import { PropertyFormPage, flattenMessages } from './property-form';

const detail = (): PropertyDetail => ({
  id: 5, title: 'Harbour Loft', location: 'Chania, Greece', price_per_night: '91.50', capacity: 3,
  amenities: ['wifi', 'hot_tub'], is_active: true, cover_image: 'https://img.test/b.jpg', rating_avg: null, review_count: 0,
  description: 'Lovely.', created_at: '', updated_at: '', availability: { booked_ranges: [] },
  // admins get the exact point (TICKET-034)
  latitude: 35.5173, longitude: 24.0178, location_is_approximate: false, location_radius_m: null,
  images: [
    { id: 1, image: 'https://img.test/a.jpg', is_cover: false },
    { id: 2, image: 'https://img.test/b.jpg', is_cover: true },
  ],
});

describe('PropertyFormPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.fn>;

  async function open(url: string): Promise<PropertyFormPage> {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'admin/properties/new', component: PropertyFormPage },
          { path: 'admin/properties/:id/edit', component: PropertyFormPage },
        ]),
        // The map is tested in shared/map; here it never finishes loading.
        { provide: MapLoader, useValue: { load: () => new Promise(() => undefined) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockImplementation((() => undefined) as never);
    harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl(url, PropertyFormPage);
    navigate = vi.fn().mockResolvedValue(true);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(navigate as never);
    return page;
  }

  it('flattens nested DRF errors', () => {
    expect(flattenMessages([{ image: ['Enter a valid URL.'] }, {}])).toEqual(['Enter a valid URL.']);
    expect(flattenMessages(['Only one image can be the cover.'])).toEqual(['Only one image can be the cover.']);
  });

  it('new: blocks an invalid form, then POSTs a clean body and returns to the list', async () => {
    const page = await open('/admin/properties/new');
    page.save();
    http.expectNone(PROPERTIES_URL);
    expect(page.error()).toBe('Please fix the highlighted fields.');
    expect(page.controlError('title')).toBe('Required.');
    // TICKET-034 step 7: the map position is required too
    expect(page.controlError('position')).toBe('Set the map position: find the address or click the map.');

    page.form.patchValue({
      title: ' Harbour Loft ', location: 'Chania, Greece', description: '', price: 91.5, capacity: 3,
      amenities: ['wifi'], images: [{ image: 'https://img.test/a.jpg', is_cover: true }],
      position: { lat: 35.5173, lng: 24.0178 },
    });
    page.form.markAsDirty();
    expect(page.hasUnsavedChanges()).toBe(true);
    page.save();
    const req = http.expectOne({ url: PROPERTIES_URL, method: 'POST' });
    expect(req.request.body).toEqual({
      title: 'Harbour Loft', location: 'Chania, Greece', description: '', price_per_night: '91.50', capacity: 3,
      amenities: ['wifi'], is_active: true, images: [{ image: 'https://img.test/a.jpg', is_cover: true }],
      latitude: 35.5173, longitude: 24.0178,
    });
    req.flush({ ...detail(), id: 9 });
    expect(page.hasUnsavedChanges()).toBe(false); // so the guard lets us leave
    expect(navigate).toHaveBeenCalledWith(['/admin/properties']);
  });

  it('edit: loads the property into the form and PATCHes the full body (images replace the set)', async () => {
    const page = await open('/admin/properties/5/edit');
    http.expectOne(`${PROPERTIES_URL}5/`).flush(detail());
    harness.detectChanges();
    expect(page.form.getRawValue()).toMatchObject({
      title: 'Harbour Loft', price: 91.5, capacity: 3, amenities: ['wifi', 'hot_tub'],
      position: { lat: 35.5173, lng: 24.0178 },
    });
    expect(page.form.dirty).toBe(false);

    page.form.controls.price.setValue(99);
    page.form.markAsDirty();
    page.save();
    const req = http.expectOne({ url: `${PROPERTIES_URL}5/`, method: 'PATCH' });
    expect(req.request.body.price_per_night).toBe('99.00');
    expect([req.request.body.latitude, req.request.body.longitude]).toEqual([35.5173, 24.0178]);
    expect(req.request.body.images).toEqual([
      { image: 'https://img.test/a.jpg', is_cover: false },
      { image: 'https://img.test/b.jpg', is_cover: true },
    ]);
    req.flush(detail());
  });

  it('server validation errors land under the right fields (including nested image errors)', async () => {
    const page = await open('/admin/properties/5/edit');
    http.expectOne(`${PROPERTIES_URL}5/`).flush(detail());
    page.save();
    http.expectOne({ url: `${PROPERTIES_URL}5/`, method: 'PATCH' }).flush(
      { price_per_night: ['Ensure this value is greater than or equal to 0.01.'], images: [{ image: ['Enter a valid URL.'] }, {}] },
      { status: 400, statusText: 'Bad Request' },
    );
    expect(page.controlError('price')).toBe('Ensure this value is greater than or equal to 0.01.');
    expect(page.controlError('images')).toBe('Enter a valid URL.');
    expect(page.saving()).toBe(false);
  });

  it("a map-position error from the server lands under Map position", async () => {
    const page = await open('/admin/properties/5/edit');
    http.expectOne(`${PROPERTIES_URL}5/`).flush(detail());
    page.save();
    http.expectOne({ url: `${PROPERTIES_URL}5/`, method: 'PATCH' }).flush(
      { latitude: ["A map position can't be removed - move the pin instead."] },
      { status: 400, statusText: 'Bad Request' },
    );
    expect(page.controlError('position')).toBe("A map position can't be removed - move the pin instead.");
  });

  it('an older place without a position must get one before saving', async () => {
    const page = await open('/admin/properties/5/edit');
    http.expectOne(`${PROPERTIES_URL}5/`).flush({ ...detail(), latitude: null, longitude: null });
    harness.detectChanges();
    expect(page.form.controls.position.value).toBeNull();
    page.save();
    http.expectNone(`${PROPERTIES_URL}5/`);
    expect(page.controlError('position')).toBe('Set the map position: find the address or click the map.');
    const el = harness.routeNativeElement as HTMLElement;
    harness.detectChanges();
    expect(el.textContent).toContain('Set the map position: find the address or click the map.');
    // the Location field pre-fills the address box
    expect(el.querySelector<HTMLInputElement>('app-location-picker input')!.value).toBe('Chania, Greece');
  });

  it('unknown id -> not found', async () => {
    const page = await open('/admin/properties/999/edit');
    http.expectOne(`${PROPERTIES_URL}999/`).flush({ detail: 'Not found.' }, { status: 404, statusText: 'Not Found' });
    expect(page.status()).toBe('notFound');
  });
});
