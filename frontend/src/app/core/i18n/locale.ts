import { signal } from '@angular/core';

/**
 * The chosen language as a module-level signal (TICKET-038).
 *
 * `TranslationService` owns it (reads the saved choice, switches it), but it
 * lives here so plain helper functions - `formatPrice`, `formatDate`, the
 * chart and period labels - can read it without being injectable. Because
 * it's a signal, any template, `computed()` or effect that calls one of
 * those helpers re-runs on a switch by itself.
 */
export type Lang = 'en' | 'el';

export const DEFAULT_LANG: Lang = 'en';

/** The `Intl` locale for dates and plain numbers in each language. */
export const LOCALES: Record<Lang, string> = { en: 'en-GB', el: 'el-GR' };

/**
 * Money: English keeps `en-IE` ("€1,234.50", as before - the euro is Ireland's
 * currency, so the symbol goes in front); Greek gives "1.234,50 €".
 */
export const MONEY_LOCALES: Record<Lang, string> = { en: 'en-IE', el: 'el-GR' };

const active = signal<Lang>(DEFAULT_LANG);

/** The language in effect (a signal read - tracked). */
export function currentLang(): Lang {
  return active();
}

/** `en-GB` / `el-GR` for the language in effect (a signal read - tracked). */
export function currentLocale(): string {
  return LOCALES[active()];
}

/** Only `TranslationService` calls this. */
export function setCurrentLang(lang: Lang): void {
  active.set(lang);
}
