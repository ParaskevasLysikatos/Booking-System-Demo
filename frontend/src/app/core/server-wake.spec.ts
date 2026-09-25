import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { ServerWakeService, WAKE_NOTICE_AFTER_MS, serverWakeInterceptor } from './server-wake';

const API = `${environment.apiUrl}/properties/`;

describe('ServerWakeService + serverWakeInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let wake: ServerWakeService;

  function setup(delay: number | null = 4000) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([serverWakeInterceptor])),
        provideHttpClientTesting(),
        { provide: WAKE_NOTICE_AFTER_MS, useValue: delay },
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
    wake = TestBed.inject(ServerWakeService);
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns slow after the delay, and back as soon as the server answers', () => {
    setup();
    http.get(API).subscribe();
    vi.advanceTimersByTime(3999);
    expect(wake.slow()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(wake.slow()).toBe(true);
    ctrl.expectOne(API).flush({ count: 0, results: [] });
    expect(wake.slow()).toBe(false);
  });

  it('a quick answer never shows it', () => {
    setup();
    http.get(API).subscribe();
    ctrl.expectOne(API).flush({});
    vi.advanceTimersByTime(10_000);
    expect(wake.slow()).toBe(false);
  });

  it('an HTTP error proves the server is up; "no answer" (status 0) does not', () => {
    setup();
    http.get(API).subscribe({ error: () => undefined });
    http.get(`${environment.apiUrl}/health/`).subscribe({ error: () => undefined });
    vi.advanceTimersByTime(4000);
    expect(wake.slow()).toBe(true);
    ctrl.expectOne(API).error(new ProgressEvent('error'), { status: 0 });
    expect(wake.slow()).toBe(true); // the other one is still waiting
    ctrl.expectOne(`${environment.apiUrl}/health/`).flush({}, { status: 500, statusText: 'Server Error' });
    expect(wake.slow()).toBe(false);
  });

  it('clears when the waiting request is cancelled', () => {
    setup();
    const sub = http.get(API).subscribe();
    vi.advanceTimersByTime(4000);
    expect(wake.slow()).toBe(true);
    sub.unsubscribe();
    expect(wake.slow()).toBe(false);
  });

  it('ignores other hosts, and is off when the delay is null (dev)', () => {
    setup(null);
    http.get(API).subscribe();
    vi.advanceTimersByTime(60_000);
    expect(wake.slow()).toBe(false);
    ctrl.expectOne(API).flush({});
  });

  it('never counts requests to other hosts', () => {
    setup();
    http.get('https://picsum.photos/x').subscribe();
    vi.advanceTimersByTime(60_000);
    expect(wake.slow()).toBe(false);
    ctrl.expectOne('https://picsum.photos/x').flush({});
  });
});
