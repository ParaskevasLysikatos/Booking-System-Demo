import { DOCUMENT } from '@angular/common';
import { Injectable, OnDestroy, Signal, computed, inject, isDevMode } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import en from './en.json';
import { DEFAULT_LANG, LOCALES, Lang, currentLang, setCurrentLang } from './locale';

export { DEFAULT_LANG, LOCALES } from './locale';
export type { Lang } from './locale';

/**
 * Two-language support (TICKET-038): English and Greek, switched at runtime
 * in one build (not Angular's build-time i18n, which needs one build and one
 * deployed site per language).
 *
 * The texts live in two dictionaries, `en.json` and `el.json`, with the same
 * nested keys (`toolbar.logIn`, `mat.paginator.nextPage`, ...). A spec checks
 * that both files have exactly the same keys and placeholders, so a missing
 * Greek text fails the tests instead of showing up on the page.
 *
 * Text features, kept deliberately small:
 * - placeholders: `"Account menu for {email}"` + `{ email: 'a@b.c' }`
 * - plurals: a key whose value is `{ "one": "...", "other": "..." }` picks the
 *   form with `Intl.PluralRules` for the `count` param (`{count} nights`).
 *
 * English is bundled with the app (it's also the fallback for any gap).
 * Greek is a separate chunk, loaded the first time it's needed: on start-up
 * when it was the saved choice (the app waits for it, so there's no flash of
 * English), or on the first switch - and it's prefetched when the pointer
 * reaches the ΕΛ button. That keeps ~56 kB out of the initial bundle.
 */
/** The toggle's order. */
export const LANGUAGES: readonly Lang[] = ['en', 'el'];

/** Short toggle labels and native names - the same in both languages. */
export const LANGUAGE_SHORT: Record<Lang, string> = { en: 'EN', el: 'ΕΛ' };
export const LANGUAGE_NAMES: Record<Lang, string> = { en: 'English', el: 'Ελληνικά' };

/** First visit: always English (`DEFAULT_LANG`, decision for TICKET-038); the toggle's choice is remembered. */
export const LANG_STORAGE_KEY = 'bsd.lang';

export type TParams = Record<string, string | number>;

/** A dictionary: nested objects whose leaves are texts. */
export interface Dictionary {
  [key: string]: string | Dictionary;
}

/** The dictionaries loaded so far: English always, Greek once it's been needed. */
export const DICTIONARIES: { en: Dictionary } & Partial<Record<Lang, Dictionary>> = { en };

const LOADERS: Record<Exclude<Lang, 'en'>, () => Promise<Dictionary>> = {
  el: () => import('./el.json').then((m) => m.default as Dictionary),
};
const loading = new Map<Lang, Promise<void>>();

/** Load a language's dictionary once (a no-op when it's already there). */
export function loadDictionary(lang: Lang): Promise<void> {
  if (DICTIONARIES[lang]) return Promise.resolve();
  let pending = loading.get(lang);
  if (!pending) {
    pending = LOADERS[lang as Exclude<Lang, 'en'>]().then(
      (dict) => {
        DICTIONARIES[lang] = dict;
        loading.delete(lang); // in-flight de-duplication only; DICTIONARIES is the cache
      },
      (err: unknown) => {
        loading.delete(lang); // e.g. offline: a later switch can try again
        throw err;
      },
    );
    loading.set(lang, pending);
  }
  return pending;
}

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'el';
}

/** `'a.b.c'` -> the value at that path (a text, a plural object, or undefined). */
export function lookup(dict: Dictionary, key: string): string | Dictionary | undefined {
  let node: string | Dictionary | undefined = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[part];
  }
  return node;
}

/** `{name}` placeholders; unknown ones are left as they are, so a typo shows. */
export function interpolate(text: string, params?: TParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** A text for `key`, or undefined when the key is missing (or isn't a text). */
export function resolve(dict: Dictionary, key: string, locale: string, params?: TParams): string | undefined {
  const value = lookup(dict, key);
  if (typeof value === 'string') return interpolate(value, params);
  if (value && typeof params?.['count'] === 'number') {
    const form = value[new Intl.PluralRules(locale).select(params['count'])] ?? value['other'];
    if (typeof form === 'string') return interpolate(form, params);
  }
  return undefined;
}

/**
 * The text for `key` in the chosen language - the same as
 * `TranslationService.t`, for plain helper functions (labels built outside a
 * component, e.g. amenity names, payment and period labels). It reads the
 * language signal, so a `computed()` or template calling it follows a switch.
 * Falls back to English, then to the key itself (with a warning in dev).
 */
export function translate(key: string, params?: TParams): string {
  const lang = currentLang();
  const dict = DICTIONARIES[lang] ?? DICTIONARIES.en;
  const text = resolve(dict, key, LOCALES[lang], params) ?? resolve(DICTIONARIES.en, key, LOCALES.en, params);
  if (text !== undefined) return text;
  if (isDevMode()) console.warn(`[i18n] missing text for "${key}"`);
  return key;
}

function readStoredLang(): Lang | null {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(stored) ? stored : null;
  } catch {
    return null; // storage blocked (private mode, site data off) - just don't remember
  }
}

function storeLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* not remembered, but the switch still works */
  }
}

@Injectable({ providedIn: 'root' })
export class TranslationService implements OnDestroy {
  private readonly document = inject(DOCUMENT);
  private readonly changes$ = new Subject<Lang>();

  /**
   * The chosen language. Templates and `computed()`s that read it follow a
   * switch. (The signal itself lives in `locale.ts`, so plain formatting
   * helpers can read it too.)
   */
  readonly lang: Signal<Lang> = computed(() => currentLang());
  /** `Intl` locale for dates and numbers: `en-GB` / `el-GR`. */
  readonly locale = computed(() => LOCALES[currentLang()]);
  /**
   * Emits after every switch - for code outside the signal world (Material's
   * intl classes, the date adapter, the page title).
   */
  readonly changes: Observable<Lang> = this.changes$.asObservable();

  /** A saved language whose dictionary isn't loaded yet - `ready()` switches to it. */
  private pending: Lang | null = null;
  /** The language most recently asked for (a slow load must not override a later click). */
  private requested: Lang;

  constructor() {
    const saved = readStoredLang() ?? DEFAULT_LANG;
    const start = DICTIONARIES[saved] ? saved : DEFAULT_LANG;
    if (start !== saved) this.pending = saved;
    this.requested = saved;
    setCurrentLang(start);
    this.document.documentElement.lang = start;
  }

  /**
   * Resolves once the saved language is in effect (its dictionary loaded).
   * The app waits for this at start-up (`provideI18n`), so a returning Greek
   * visitor never sees English first. If Greek can't be loaded (offline), the
   * app starts in English.
   */
  ready(): Promise<void> {
    const lang = this.pending;
    if (!lang) return Promise.resolve();
    this.pending = null;
    return loadDictionary(lang).then(
      () => {
        if (this.requested === lang) this.apply(lang);
      },
      () => undefined,
    );
  }

  /** Start loading a language early (e.g. when the pointer reaches its button). */
  preload(lang: Lang): void {
    loadDictionary(lang).catch(() => undefined);
  }

  /** Only happens in tests (a new TestBed): the next one starts from English again. */
  ngOnDestroy(): void {
    setCurrentLang(DEFAULT_LANG);
  }

  /**
   * Switch language. Instant when the dictionary is loaded (always for
   * English); otherwise it switches as soon as Greek has loaded. The returned
   * promise resolves when the switch is done (or rejects if Greek can't be
   * loaded - the page then stays as it was).
   */
  setLang(lang: Lang): Promise<void> {
    this.requested = lang;
    if (DICTIONARIES[lang]) {
      this.apply(lang);
      return Promise.resolve();
    }
    return loadDictionary(lang).then(() => {
      if (this.requested === lang) this.apply(lang);
    });
  }

  private apply(lang: Lang): void {
    if (lang === currentLang()) return;
    setCurrentLang(lang);
    storeLang(lang);
    this.document.documentElement.lang = lang;
    this.changes$.next(lang);
  }

  /**
   * The text for `key` in the current language. Falls back to English, then
   * to the key itself (with a warning in dev), so a gap never blanks the UI.
   * Reads the `lang` signal, so calling it inside a template or `computed()`
   * re-runs on a switch.
   */
  t(key: string, params?: TParams): string {
    return translate(key, params);
  }

  /** Whether `key` names a text (or plural object) in the English dictionary. */
  has(key: string): boolean {
    return lookup(DICTIONARIES.en, key) !== undefined;
  }
}
