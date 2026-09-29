import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, isDevMode, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import el from './el.json';
import en from './en.json';

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
 */
export type Lang = 'en' | 'el';

/** The toggle's order. */
export const LANGUAGES: readonly Lang[] = ['en', 'el'];

/** Short toggle labels and native names - the same in both languages. */
export const LANGUAGE_SHORT: Record<Lang, string> = { en: 'EN', el: 'ΕΛ' };
export const LANGUAGE_NAMES: Record<Lang, string> = { en: 'English', el: 'Ελληνικά' };

/** The `Intl` locale for dates and numbers in each language. */
export const LOCALES: Record<Lang, string> = { en: 'en-GB', el: 'el-GR' };

/** First visit: always English (decision for TICKET-038); the toggle's choice is remembered. */
export const DEFAULT_LANG: Lang = 'en';
export const LANG_STORAGE_KEY = 'bsd.lang';

export type TParams = Record<string, string | number>;

/** A dictionary: nested objects whose leaves are texts. */
export interface Dictionary {
  [key: string]: string | Dictionary;
}

export const DICTIONARIES: Record<Lang, Dictionary> = { en, el };

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
export class TranslationService {
  private readonly document = inject(DOCUMENT);
  private readonly current = signal<Lang>(readStoredLang() ?? DEFAULT_LANG);
  private readonly changes$ = new Subject<Lang>();

  /** The chosen language. Templates and `computed()`s that read it follow a switch. */
  readonly lang = this.current.asReadonly();
  /** `Intl` locale for dates and money: `en-GB` / `el-GR`. */
  readonly locale = computed(() => LOCALES[this.current()]);
  /**
   * Emits after every switch - for code outside the signal world (Material's
   * intl classes, the date adapter, the page title).
   */
  readonly changes: Observable<Lang> = this.changes$.asObservable();

  constructor() {
    this.document.documentElement.lang = this.current();
  }

  setLang(lang: Lang): void {
    if (lang === this.current()) return;
    this.current.set(lang);
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
    const lang = this.current();
    const text = resolve(DICTIONARIES[lang], key, LOCALES[lang], params) ?? resolve(DICTIONARIES.en, key, LOCALES.en, params);
    if (text !== undefined) return text;
    if (isDevMode()) console.warn(`[i18n] missing text for "${key}"`);
    return key;
  }

  /** Whether `key` names a text (or plural object) in the English dictionary. */
  has(key: string): boolean {
    return lookup(DICTIONARIES.en, key) !== undefined;
  }
}
