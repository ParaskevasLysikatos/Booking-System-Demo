import { Clipboard } from '@angular/cdk/clipboard';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { TranslationService } from '../core/i18n/translation.service';
import { PaymentsConfig } from '../core/payments/payment.models';
import { PAYMENTS_URL } from '../core/payments/payment.service';
import { TEST_CARD_NUMBER, TestCardHintComponent } from './test-card-hint';

describe('TestCardHintComponent (TICKET-044)', () => {
  let http: HttpTestingController;
  let copy: ReturnType<typeof vi.fn>;

  async function render(config: Partial<PaymentsConfig> | 'error', lang: 'en' | 'el' = 'en') {
    localStorage.clear();
    copy = vi.fn(() => true);
    TestBed.configureTestingModule({
      imports: [TestCardHintComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: Clipboard, useValue: { copy } }],
    });
    if (lang === 'el') await TestBed.inject(TranslationService).setLang('el');
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(TestCardHintComponent);
    fixture.detectChanges();
    const req = http.expectOne(`${PAYMENTS_URL}config/`);
    if (config === 'error') req.flush('down', { status: 500, statusText: 'Server Error' });
    else req.flush({ enabled: true, test_mode: false, hold_minutes: 30, currency: 'eur', ...config });
    fixture.detectChanges();
    return fixture;
  }

  const el = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;
  const text = (f: { nativeElement: unknown }) => el(f).textContent!.replace(/\s+/g, ' ').trim();

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('test mode: shows the card, expiry and CVC rule, card number in bold', async () => {
    const f = await render({ test_mode: true });
    expect(text(f)).toContain('Demo payment - use card 4242 4242 4242 4242, any future expiry date, any CVC.');
    expect(el(f).querySelector('strong')!.textContent).toBe('4242 4242 4242 4242');
    expect(el(f).querySelector('mat-icon')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows nothing when not in test mode (live key or payments off)', async () => {
    expect(text(await render({ test_mode: false }))).toBe('');
    TestBed.resetTestingModule();
    expect(text(await render({ enabled: false, test_mode: false }))).toBe('');
  });

  it("shows nothing when the config can't be loaded", async () => {
    expect(text(await render('error'))).toBe('');
  });

  it('the copy button copies the bare card number and says so, then resets', async () => {
    const f = await render({ test_mode: true });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const button = el(f).querySelector('button')!;
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Copy card number');

    button.click();
    f.detectChanges();
    expect(copy).toHaveBeenCalledExactlyOnceWith(TEST_CARD_NUMBER);
    expect(TEST_CARD_NUMBER).toBe('4242424242424242');
    expect(button.textContent).toContain('check');
    expect(el(f).querySelector('[aria-live="polite"]')!.textContent).toContain('Card number copied');

    vi.advanceTimersByTime(2000);
    f.detectChanges();
    expect(button.textContent).toContain('content_copy');
    expect(el(f).querySelector('[aria-live="polite"]')!.textContent!.trim()).toBe('');
  });

  it('a failed copy shows no "copied"', async () => {
    const f = await render({ test_mode: true });
    copy.mockReturnValue(false);
    el(f).querySelector('button')!.click();
    f.detectChanges();
    expect(el(f).querySelector('[aria-live="polite"]')!.textContent!.trim()).toBe('');
  });

  it('in Greek', async () => {
    const f = await render({ test_mode: true }, 'el');
    expect(text(f)).toContain('Δοκιμαστική πληρωμή - χρησιμοποιήστε την κάρτα 4242 4242 4242 4242');
    expect(text(f)).toContain('οποιοδήποτε CVC.');
    expect(el(f).querySelector('button')!.getAttribute('aria-label')).toBe('Αντιγραφή αριθμού κάρτας');
    el(f).querySelector('button')!.click();
    f.detectChanges();
    expect(el(f).querySelector('[aria-live="polite"]')!.textContent).toContain('Ο αριθμός κάρτας αντιγράφηκε');
    await TestBed.inject(TranslationService).setLang('en');
  });
});
