import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { DemoLogin } from '../../core/auth/auth.models';
import { AUTH_URL } from '../../core/auth/auth.service';
import { tokenExpiringIn } from '../../testing/fake-jwt';
import { TranslationService } from '../../core/i18n/translation.service';
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

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  const DEMO_URL = `${AUTH_URL}/demo-logins/`;
  const GUEST: DemoLogin = {
    role: 'guest',
    email: 'guest1@demo.com',
    password: 'guest123',
    count: 10,
    last_email: 'guest10@demo.com',
  };
  const ADMIN: DemoLogin = { role: 'admin', email: 'admin@demo.com', password: 'admin123' };

  /** Renders the page and answers its demo-logins request (TICKET-041). */
  async function render(logins: DemoLogin[] = []) {
    const fixture = TestBed.createComponent(LoginPage);
    http.expectOne(DEMO_URL).flush({ logins });
    await fixture.whenStable();
    return fixture;
  }

  function demoBox(fixture: { nativeElement: HTMLElement }) {
    return fixture.nativeElement.querySelector<HTMLElement>('.demo-logins');
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

  it('in Greek (TICKET-038): labels, button and the demo box, switched without a reload', async () => {
    const fixture = await render([GUEST, ADMIN]);
    TestBed.inject(TranslationService).setLang('el');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('mat-card-title')!.textContent).toContain('Σύνδεση');
    expect([...el.querySelectorAll('mat-label')].map((l) => l.textContent!.trim())).toEqual(['Email', 'Κωδικός πρόσβασης']);
    expect(demoBox(fixture)!.textContent).toContain('Λογαριασμοί επίδειξης');
    expect(demoBox(fixture)!.textContent).toContain('οποιοσδήποτε έως guest10@demo.com');
    const buttons = [...demoBox(fixture)!.querySelectorAll('button')];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Συμπλήρωση του λογαριασμού επίδειξης (επισκέπτης)',
      'Συμπλήρωση του λογαριασμού επίδειξης (διαχειριστής)',
    ]);
    expect(el.textContent).toContain('Δεν έχετε λογαριασμό;');
  });

  describe('demo logins (TICKET-041)', () => {
    it('shows no box without demo accounts', async () => {
      const fixture = await render([]);
      expect(demoBox(fixture)).toBeNull();
    });

    it('lists the guest and admin logins', async () => {
      const fixture = await render([GUEST, ADMIN]);
      const box = demoBox(fixture)!;
      expect(box.querySelector('h2')?.textContent).toContain('Demo logins');
      const text = box.textContent ?? '';
      expect(text).toContain('guest1@demo.com / guest123');
      expect(text).toContain('any up to guest10@demo.com');
      expect(text).toContain('admin@demo.com / admin123');
      const buttons = Array.from(box.querySelectorAll('button')).map((b) => b.textContent?.trim());
      expect(buttons[0]).toContain('Guest');
      expect(buttons[1]).toContain('Admin');
    });

    it('fills the form on click - the visitor still presses Log in', async () => {
      const fixture = await render([GUEST, ADMIN]);
      const [guestBtn, adminBtn] = Array.from(demoBox(fixture)!.querySelectorAll('button'));
      adminBtn.click();
      expect(fixture.componentInstance.form.getRawValue()).toEqual({
        email: 'admin@demo.com',
        password: 'admin123',
      });
      guestBtn.click();
      expect(fixture.componentInstance.form.getRawValue()).toEqual({
        email: 'guest1@demo.com',
        password: 'guest123',
      });
      http.expectNone(`${AUTH_URL}/login/`);
    });

    it('clears an old error when a demo login is picked', async () => {
      const fixture = await render([GUEST]);
      fixture.componentInstance.error.set('No active account found');
      (demoBox(fixture)!.querySelector('button') as HTMLButtonElement).click();
      expect(fixture.componentInstance.error()).toBeNull();
    });

    it('a filled demo login logs in like any other', async () => {
      const fixture = await render([ADMIN]);
      (demoBox(fixture)!.querySelector('button') as HTMLButtonElement).click();
      fixture.componentInstance.submit();
      const req = http.expectOne(`${AUTH_URL}/login/`);
      expect(req.request.body).toEqual({ email: 'admin@demo.com', password: 'admin123' });
    });

    it('a single demo guest gets no "any up to" line', async () => {
      const fixture = await render([{ ...GUEST, count: 1, last_email: 'guest1@demo.com' }]);
      expect(demoBox(fixture)!.textContent).not.toContain('any up to');
    });

    it('a failed request just means no box and no error', async () => {
      const fixture = TestBed.createComponent(LoginPage);
      http.expectOne(DEMO_URL).flush('down', { status: 503, statusText: 'Service Unavailable' });
      await fixture.whenStable();
      expect(demoBox(fixture)).toBeNull();
      expect((fixture.nativeElement as HTMLElement).querySelector('[role=alert]')).toBeNull();
    });
  });
});

describe('LoginPage after a heart tap (TICKET-033)', () => {
  it('explains that the place is saved after logging in', async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'login', component: LoginPage }]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/login?returnUrl=%2Flistings&reason=favorite', LoginPage);
    const text = (harness.routeNativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain("Log in to save this place - it's saved as soon as you're in.");
    expect(text).not.toContain('Your session expired');
  });
});
