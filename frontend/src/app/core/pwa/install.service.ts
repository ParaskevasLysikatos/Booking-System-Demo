import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

/**
 * The event Chromium browsers (Chrome, Edge, Samsung Internet, Android) fire
 * when the site can be installed. Not in TypeScript's DOM types yet.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/** What `install()` did: the browser's own prompt was answered, or iOS needs the manual steps. */
export type InstallResult = 'accepted' | 'dismissed' | 'ios-instructions' | 'unavailable';

/**
 * "Install app" (TICKET-031). The app is installable through its web app
 * manifest alone - no service worker, so nothing is ever served from a cache.
 *
 * - Chrome / Edge / Android: the browser fires `beforeinstallprompt`; we keep
 *   the event (instead of letting the browser show its own mini-bar) and
 *   replay it when the user taps our Install button. A prompt can only be
 *   used once, so it's dropped afterwards; the browser fires a new one if the
 *   user said no and it's still installable.
 * - iPhone / iPad: Safari has no install event, so the button stays visible
 *   and shows "Share → Add to Home Screen" steps instead.
 * - Already running as the installed app (or just installed): no button.
 *
 * Created at start-up by `App` so the event is caught even if it fires
 * before the toolbar exists.
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private readonly win = inject(DOCUMENT).defaultView;
  private readonly deferred = signal<BeforeInstallPromptEvent | null>(null);

  /** Running as the installed app (standalone window / home-screen icon), or installed during this visit. */
  readonly installed = signal(this.runningStandalone());
  /** iPhone / iPad (including iPadOS, which reports itself as a Mac with touch). */
  readonly isIos = this.detectIos();
  /** Show an Install button/menu item. */
  readonly canInstall = computed(() => !this.installed() && (this.deferred() !== null || this.isIos));

  constructor() {
    const w = this.win;
    if (!w) return;
    w.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault(); // we show our own button instead of the browser's mini-infobar
      this.deferred.set(event as BeforeInstallPromptEvent);
    });
    w.addEventListener('appinstalled', () => {
      this.deferred.set(null);
      this.installed.set(true);
    });
  }

  async install(): Promise<InstallResult> {
    const event = this.deferred();
    if (event) {
      this.deferred.set(null); // each prompt event works only once
      await event.prompt();
      const { outcome } = await event.userChoice;
      return outcome;
    }
    return this.isIos && !this.installed() ? 'ios-instructions' : 'unavailable';
  }

  private runningStandalone(): boolean {
    const w = this.win;
    if (!w) return false;
    const iosStandalone = (w.navigator as Navigator & { standalone?: boolean }).standalone === true;
    return iosStandalone || (w.matchMedia?.('(display-mode: standalone)').matches ?? false);
  }

  private detectIos(): boolean {
    const nav = this.win?.navigator;
    if (!nav) return false;
    return /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  }
}
