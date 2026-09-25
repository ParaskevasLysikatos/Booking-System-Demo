import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { ToolbarComponent } from './toolbar';

describe('ToolbarComponent', () => {
  function render(stored: 'guest' | 'admin' | null) {
    localStorage.clear();
    if (stored) {
      localStorage.setItem('bsd.user', JSON.stringify({ id: 1, email: `${stored}@example.com`, role: stored }));
    }
    TestBed.configureTestingModule({
      imports: [ToolbarComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(ToolbarComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const links = () => [...el.querySelectorAll('nav.links a')].map((a) => a.textContent!.replace(/\s+/g, ' ').trim());
    return { fixture, el, links };
  }

  it('logged out: Log in / Sign up, no links, no account menu', () => {
    const { el, links } = render(null);
    expect(el.textContent).toContain('Log in');
    expect(el.textContent).toContain('Sign up');
    expect(links()).toEqual([]);
    expect(el.querySelector('.account')).toBeNull();
  });

  it('guest: My bookings only - no Admin link', () => {
    const { links, el } = render('guest');
    expect(links()).toEqual(['luggageMy bookings']);
    expect(el.querySelector('.account')!.textContent).toContain('guest@example.com');
  });

  it('admin: My bookings + Admin', () => {
    const { links } = render('admin');
    expect(links()).toEqual(['luggageMy bookings', 'admin_panel_settingsAdmin']);
  });

  it('the Admin link follows the role live (e.g. after /me/ says demoted)', () => {
    const { fixture, links } = render('admin');
    // simulate AuthService picking up a role change
    (TestBed.inject(AuthService) as unknown as { user: { set: (u: unknown) => void } }).user.set({
      id: 1, email: 'admin@example.com', role: 'guest',
    });
    fixture.detectChanges();
    expect(links()).toEqual(['luggageMy bookings']);
  });

  it('account menu shows email, role and Log out', async () => {
    const { fixture, el } = render('admin');
    (el.querySelector('.account') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const menu = document.querySelector('.mat-mdc-menu-panel')!;
    expect(menu.textContent).toContain('admin@example.com');
    expect(menu.textContent).toContain('Admin');
    expect(menu.textContent).toContain('Log out');
  });
});
