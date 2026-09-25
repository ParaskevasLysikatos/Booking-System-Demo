import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { AUTH_URL } from '../../core/auth/auth.service';
import { tokenExpiringIn } from '../../testing/fake-jwt';
import { LoginPage } from './login';

describe('LoginPage', () => {
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => http.verify());

  async function render() {
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    return fixture;
  }

  it('does not submit an invalid form and shows field errors', async () => {
    const fixture = await render();
    fixture.componentInstance.form.setValue({ email: 'not-an-email', password: '' });
    fixture.componentInstance.submit();
    await fixture.whenStable();
    http.expectNone(`${AUTH_URL}/login/`);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Enter a valid email address.');
    expect(text).toContain('Password is required.');
  });

  it('logs in and goes home', async () => {
    const fixture = await render();
    fixture.componentInstance.form.setValue({ email: 'maria@example.com', password: 'pw' });
    fixture.componentInstance.submit();
    const req = http.expectOne(`${AUTH_URL}/login/`);
    expect(req.request.body).toEqual({ email: 'maria@example.com', password: 'pw' });
    req.flush({ access: tokenExpiringIn(1800), refresh: tokenExpiringIn(86400), user: { id: 1, email: 'maria@example.com', role: 'guest' } });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it("shows the backend's message on bad credentials", async () => {
    const fixture = await render();
    fixture.componentInstance.form.setValue({ email: 'maria@example.com', password: 'wrong' });
    fixture.componentInstance.submit();
    http.expectOne(`${AUTH_URL}/login/`).flush(
      { detail: 'No active account found with the given credentials' },
      { status: 401, statusText: 'Unauthorized' },
    );
    await fixture.whenStable();
    expect(fixture.componentInstance.submitting()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('[role=alert]')?.textContent).toContain(
      'No active account found',
    );
  });
});
