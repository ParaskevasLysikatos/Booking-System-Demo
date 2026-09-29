import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { languageInterceptor } from './language.interceptor';
import { TranslationService } from './translation.service';

const API = environment.apiUrl;

describe('languageInterceptor (TICKET-038)', () => {
  let client: HttpClient;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([languageInterceptor])), provideHttpClientTesting()],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('sends the chosen language to our API only', () => {
    client.get(`${API}/properties/`).subscribe();
    client.get('https://nominatim.openstreetmap.org/search').subscribe();
    expect(http.expectOne(`${API}/properties/`).request.headers.get('Accept-Language')).toBe('en');
    expect(http.expectOne('https://nominatim.openstreetmap.org/search').request.headers.has('Accept-Language')).toBe(false);
  });

  it('follows a switch', () => {
    TestBed.inject(TranslationService).setLang('el');
    client.post(`${API}/bookings/`, {}).subscribe();
    expect(http.expectOne(`${API}/bookings/`).request.headers.get('Accept-Language')).toBe('el');
  });
});
