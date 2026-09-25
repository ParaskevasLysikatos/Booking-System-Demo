import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { AUTH_URL } from '../../core/auth/auth.service';
import { tokenExpiringIn } from '../../testing/fake-jwt';
import { RegisterPage } from './register';

describe('RegisterPage', () => {
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [RegisterPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => http.verify());

  const valid = {
    email: 'maria@example.com', password: 'S3cure-Pass!', confirmPassword: 'S3cure-Pass!',
    firstName: ' Maria ', lastName: '', phone: '',
  };

  it('requires matching passwords (re-checked when the first one changes)', () => {
    const page = TestBed.createComponent(RegisterPage).componentInstance;
    page.form.setValue({ ...valid, confirmPassword: 'different' });
    expect(page.form.controls.confirmPassword.hasError('mismatch')).toBe(true);
    page.form.controls.password.setValue('different');
    expect(page.form.controls.confirmPassword.hasError('mismatch')).toBe(false);
  });

  it('sends only filled-in optional fields, trimmed, and logs in', () => {
    const page = TestBed.createComponent(RegisterPage).componentInstance;
    page.form.setValue(valid);
    page.submit();
    const req = http.expectOne(`${AUTH_URL}/register/`);
    expect(req.request.body).toEqual({ email: 'maria@example.com', password: 'S3cure-Pass!', first_name: 'Maria' });
    req.flush({ user: { id: 2, email: 'maria@example.com', role: 'guest' }, access: tokenExpiringIn(1800), refresh: tokenExpiringIn(86400) },
      { status: 201, statusText: 'Created' });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('puts server validation messages under the right fields', async () => {
    const fixture = TestBed.createComponent(RegisterPage);
    const page = fixture.componentInstance;
    await fixture.whenStable(); // form rendered first, as it is for a real user
    page.form.setValue(valid);
    page.submit();
    http.expectOne(`${AUTH_URL}/register/`).flush(
      { email: ['An account with this email already exists.'], password: ['This password is too common.'] },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();
    expect(page.form.controls.email.getError('server')).toBe('An account with this email already exists.');
    expect(page.form.controls.password.getError('server')).toBe('This password is too common.');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('An account with this email already exists.');
    expect(text).toContain('This password is too common.');
    // editing the field clears the server error
    page.form.controls.email.setValue('other@example.com');
    expect(page.form.controls.email.hasError('server')).toBe(false);
  });
});
