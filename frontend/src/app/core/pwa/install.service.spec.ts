import { TestBed } from '@angular/core/testing';

import { InstallService } from './install.service';

/** A stand-in for Chrome's beforeinstallprompt event. */
function installPrompt(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = vi.fn().mockResolvedValue(undefined);
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome, platform: 'web' }) });
  return { event, prompt };
}

describe('InstallService (TICKET-031)', () => {
  const restore: (() => void)[] = [];

  function fakeNavigator(props: { userAgent?: string; platform?: string; maxTouchPoints?: number; standalone?: boolean }) {
    for (const [key, value] of Object.entries(props)) {
      const had = Object.getOwnPropertyDescriptor(navigator, key);
      Object.defineProperty(navigator, key, { configurable: true, get: () => value });
      restore.push(() => (had ? Object.defineProperty(navigator, key, had) : delete (navigator as unknown as Record<string, unknown>)[key]));
    }
  }

  function fakeDisplayMode(standalone: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({ matches: standalone && q === '(display-mode: standalone)' }),
    });
    restore.push(() => delete (window as unknown as Record<string, unknown>)['matchMedia']);
  }

  const create = () => TestBed.inject(InstallService);

  afterEach(() => restore.splice(0).reverse().forEach((undo) => undo()));

  it('desktop/Android: nothing to offer until the browser says the app can be installed', () => {
    const service = create();
    expect(service.canInstall()).toBe(false);

    const { event } = installPrompt('accepted');
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); // the browser's own mini-bar is suppressed
    expect(service.canInstall()).toBe(true);
  });

  it('install() replays the browser prompt once and reports the answer', async () => {
    const service = create();
    const { event, prompt } = installPrompt('dismissed');
    window.dispatchEvent(event);

    await expect(service.install()).resolves.toBe('dismissed');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(service.canInstall()).toBe(false); // a prompt event can't be reused
    await expect(service.install()).resolves.toBe('unavailable');
  });

  it('hides the option once the app has been installed', () => {
    const service = create();
    window.dispatchEvent(installPrompt('accepted').event);
    window.dispatchEvent(new Event('appinstalled'));
    expect(service.installed()).toBe(true);
    expect(service.canInstall()).toBe(false);
  });

  it('iPhone: always offered, and install() asks for the Share → Add to Home Screen steps', async () => {
    fakeNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1' });
    const service = create();
    expect(service.isIos).toBe(true);
    expect(service.canInstall()).toBe(true);
    await expect(service.install()).resolves.toBe('ios-instructions');
  });

  it('iPad (reports itself as a Mac with touch) counts as iOS', () => {
    fakeNavigator({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 });
    expect(create().isIos).toBe(true);
  });

  it('already running as the installed app: never offered', () => {
    fakeDisplayMode(true);
    const service = create();
    window.dispatchEvent(installPrompt('accepted').event);
    expect(service.installed()).toBe(true);
    expect(service.canInstall()).toBe(false);
  });

  it('iPhone home-screen app (navigator.standalone): never offered', () => {
    fakeNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', standalone: true });
    expect(create().canInstall()).toBe(false);
  });
});
