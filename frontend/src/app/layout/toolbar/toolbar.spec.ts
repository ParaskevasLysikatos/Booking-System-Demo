import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { TranslationService } from '../../core/i18n/translation.service';
import { InstallService } from '../../core/pwa/install.service';
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

  it('guest: Saved + My bookings - no Admin link', () => {
    const { links, el } = render('guest');
    expect(links()).toEqual(['favorite_borderSaved', 'luggageMy bookings']);
    expect(el.querySelector('.account')!.textContent).toContain('guest@example.com');
  });

  it('admin: My bookings + Admin (no Saved - admins have no hearts)', () => {
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
    expect(links()).toEqual(['favorite_borderSaved', 'luggageMy bookings']);
  });

  it('guest account menu repeats Saved for phones (TICKET-033)', async () => {
    const { fixture, el } = render('guest');
    (el.querySelector('.account') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const items = [...document.querySelectorAll('.mat-mdc-menu-panel a.menu-link')];
    expect(items.map((a) => a.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['favorite_borderSaved', 'luggageMy bookings']);
    expect(items[0].getAttribute('href')).toBe('/favorites');
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

  describe('Install app (TICKET-031)', () => {
    /** The browser saying "this site can be installed" (Chrome's beforeinstallprompt). */
    function browserOffersInstall() {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(event, { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }) });
      window.dispatchEvent(event);
    }

    it('logged out: an install icon next to Log in, only once the browser can install', async () => {
      const { fixture, el } = render(null);
      expect(el.querySelector('button.install')).toBeNull();

      const install = vi.spyOn(TestBed.inject(InstallService), 'install').mockResolvedValue('accepted');
      browserOffersInstall();
      fixture.detectChanges();
      await fixture.whenStable();
      const button = el.querySelector<HTMLButtonElement>('button.install')!;
      expect(button.getAttribute('aria-label')).toBe('Install app');
      button.click();
      expect(install).toHaveBeenCalled();
    });

    it('logged in: "Install app" in the account menu; on iPhone it opens the steps dialog', async () => {
      const { fixture, el } = render('guest');
      vi.spyOn(TestBed.inject(InstallService), 'install').mockResolvedValue('ios-instructions');
      browserOffersInstall();
      fixture.detectChanges();
      (el.querySelector('.account') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      const item = document.querySelector<HTMLButtonElement>('.mat-mdc-menu-panel button.install')!;
      expect(item.textContent).toContain('Install app');

      item.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(document.querySelector('app-install-ios-dialog')!.textContent).toContain('Add to Home Screen');
    });
  });
  describe('EN / ΕΛ (TICKET-038)', () => {
    afterEach(() => localStorage.clear());

    const options = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.lang button')];

    it('shows both options, English pressed on a first visit', () => {
      const { el } = render(null);
      expect(options(el).map((b) => b.textContent!.trim())).toEqual(['EN', 'ΕΛ']);
      expect(options(el).map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
      expect(options(el)[1].getAttribute('aria-label')).toBe('Ελληνικά');
    });

    it('ΕΛ switches the toolbar at once and is remembered', async () => {
      const { fixture, el } = render(null);
      options(el)[1].click();
      await fixture.whenStable();
      expect(TestBed.inject(TranslationService).lang()).toBe('el');
      expect(localStorage.getItem('bsd.lang')).toBe('el');
      expect(options(el).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
      expect(el.textContent).toContain('Σύνδεση');
      expect(el.textContent).toContain('Εγγραφή');
      expect(el.querySelector('.lang')!.getAttribute('aria-label')).toBe('Γλώσσα');
    });

    it('logged in, in Greek: links, account menu and role', async () => {
      localStorage.setItem('bsd.lang', 'el');
      const { fixture, el, links } = render('guest'); // render() clears storage first
      TestBed.inject(TranslationService).setLang('el');
      await fixture.whenStable();
      expect(links()).toEqual(['favorite_borderΑποθηκευμένα', 'luggageΟι κρατήσεις μου']);
      expect(el.querySelector('.account')!.getAttribute('aria-label')).toBe('Μενού λογαριασμού για guest@example.com');
      (el.querySelector('.account') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      const menu = document.querySelector('.mat-mdc-menu-panel')!;
      expect(menu.textContent).toContain('Επισκέπτης');
      expect(menu.textContent).toContain('Αποσύνδεση');
    });
  });
});
