import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslatePipe } from './translate.pipe';
import { TranslationService } from './translation.service';

@Component({
  imports: [TranslatePipe],
  // OnPush on purpose: a switch must still reach views that only refresh on signals.
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="plain">{{ 'toolbar.logIn' | t }}</p><p class="param">{{ 'toolbar.accountMenu' | t: { email: email() } }}</p>`,
})
class HostComponent {
  readonly email = signal('a@b.gr');
}

describe('t pipe (TICKET-038)', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });
  afterEach(() => localStorage.clear());

  it('translates, and follows a language switch without a reload', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.plain')!.textContent).toBe('Log in');
    expect(el.querySelector('.param')!.textContent).toBe('Account menu for a@b.gr');

    TestBed.inject(TranslationService).setLang('el');
    await fixture.whenStable();
    expect(el.querySelector('.plain')!.textContent).toBe('Σύνδεση');
    expect(el.querySelector('.param')!.textContent).toBe('Μενού λογαριασμού για a@b.gr');
  });

  it('re-translates when a param changes', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    fixture.componentInstance.email.set('c@d.gr');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.param')!.textContent).toBe('Account menu for c@d.gr');
  });

  it('caches: no new lookup while key, params and language stay the same', () => {
    TestBed.runInInjectionContext(() => {
      const pipe = new TranslatePipe();
      const t = vi.spyOn(TestBed.inject(TranslationService), 't');
      pipe.transform('toolbar.logIn');
      pipe.transform('toolbar.logIn');
      pipe.transform('toolbar.accountMenu', { email: 'x' });
      pipe.transform('toolbar.accountMenu', { email: 'x' }); // new object, same values
      expect(t).toHaveBeenCalledTimes(2);
    });
  });
});
