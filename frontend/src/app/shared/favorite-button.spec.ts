import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { FAVORITES_URL } from '../core/favorites/favorite.service';
import { FavoriteButtonComponent } from './favorite-button';

describe('FavoriteButtonComponent', () => {
  let http: HttpTestingController;

  function render(
    opts: {
      saved?: boolean;
      variant?: 'overlay' | 'labeled';
      role?: 'guest' | 'admin' | null;
    } = {},
  ) {
    localStorage.clear();
    const role = opts.role === undefined ? 'guest' : opts.role;
    if (role)
      localStorage.setItem('bsd.user', JSON.stringify({ id: 7, email: 'g@example.com', role }));
    TestBed.configureTestingModule({
      imports: [FavoriteButtonComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(FavoriteButtonComponent);
    fixture.componentRef.setInput('property', {
      id: 5,
      title: 'Harbour Loft',
      is_favorite: !!opts.saved,
    });
    if (opts.variant) fixture.componentRef.setInput('variant', opts.variant);
    fixture.detectChanges();
    return fixture;
  }

  const button = (el: HTMLElement) => el.querySelector('button')!;

  afterEach(() => http.verify());

  it('is a toggle button labelled with the place, not pressed when not saved', () => {
    const el = render().nativeElement as HTMLElement;
    const b = button(el);
    expect(b.getAttribute('type')).toBe('button');
    expect(b.getAttribute('aria-label')).toBe('Save Harbour Loft');
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(b.textContent).toContain('favorite_border');
  });

  it('shows the saved state from the server', () => {
    const b = button(render({ saved: true }).nativeElement);
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.classList).toContain('saved');
    expect(b.textContent!.trim()).toBe('favorite');
  });

  it('a tap fills the heart at once and saves it', () => {
    const fixture = render();
    const b = button(fixture.nativeElement);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    b.dispatchEvent(click);
    fixture.detectChanges();
    expect(click.defaultPrevented).toBe(true);
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.getAttribute('aria-busy')).toBe('true');
    http.expectOne(`${FAVORITES_URL}5/`).flush({ property: 5, is_favorite: true, saved_at: '' });
    fixture.detectChanges();
    expect(b.getAttribute('aria-busy')).toBeNull();
  });

  it('labeled variant says Save / Saved (visible text hidden from screen readers)', () => {
    const fixture = render({ variant: 'labeled' });
    const b = button(fixture.nativeElement);
    expect(b.textContent).toContain('Save');
    expect(b.querySelector('span[aria-hidden="true"]')!.textContent).toBe('Save');
    b.click();
    fixture.detectChanges();
    expect(b.querySelector('span[aria-hidden="true"]')!.textContent).toBe('Saved');
    http.expectOne(`${FAVORITES_URL}5/`).flush({ property: 5, is_favorite: true, saved_at: '' });
  });

  it('is shown to logged-out visitors', () => {
    expect(button(render({ role: null }).nativeElement)).not.toBeNull();
  });

  it('is not shown to admins', () => {
    expect(
      (render({ role: 'admin' }).nativeElement as HTMLElement).querySelector('button'),
    ).toBeNull();
  });
});
