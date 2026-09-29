import { TestBed } from '@angular/core/testing';

import { DICTIONARIES, LANG_STORAGE_KEY, Lang, TranslationService, interpolate } from './translation.service';

describe('TranslationService (TICKET-038)', () => {
  function create(stored?: string): TranslationService {
    localStorage.clear();
    if (stored !== undefined) localStorage.setItem(LANG_STORAGE_KEY, stored);
    document.documentElement.lang = 'en';
    TestBed.configureTestingModule({});
    return TestBed.inject(TranslationService);
  }

  afterEach(() => localStorage.clear());

  it('first visit: English (not the browser language), and <html lang="en">', () => {
    const i18n = create();
    expect(i18n.lang()).toBe('en');
    expect(i18n.locale()).toBe('en-GB');
    expect(document.documentElement.lang).toBe('en');
    expect(i18n.t('toolbar.logIn')).toBe('Log in');
  });

  it('restores the remembered language', () => {
    const i18n = create('el');
    expect(i18n.lang()).toBe('el');
    expect(i18n.locale()).toBe('el-GR');
    expect(document.documentElement.lang).toBe('el');
    expect(i18n.t('toolbar.logIn')).toBe('Σύνδεση');
  });

  it('ignores a junk stored value', () => {
    expect(create('fr').lang()).toBe('en');
  });

  it('setLang switches, remembers, sets <html lang> and emits once', () => {
    const i18n = create();
    const seen: Lang[] = [];
    i18n.changes.subscribe((l) => seen.push(l));

    i18n.setLang('el');
    i18n.setLang('el'); // no-op
    expect(i18n.lang()).toBe('el');
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('el');
    expect(document.documentElement.lang).toBe('el');
    expect(seen).toEqual(['el']);

    i18n.setLang('en');
    expect(seen).toEqual(['el', 'en']);
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('en');
  });

  it('still switches when storage is blocked', () => {
    const i18n = create();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    i18n.setLang('el');
    expect(i18n.lang()).toBe('el');
    vi.restoreAllMocks();
  });

  it('fills {placeholders}', () => {
    const i18n = create('el');
    expect(i18n.t('toolbar.accountMenu', { email: 'a@b.gr' })).toBe('Μενού λογαριασμού για a@b.gr');
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}'); // an unknown one stays visible
  });

  describe('plurals, gaps', () => {
    beforeEach(() => {
      (DICTIONARIES.en as Record<string, unknown>)['_test'] = {
        nights: { one: '{count} night', other: '{count} nights' },
        onlyEnglish: 'Only in English',
      };
      (DICTIONARIES.el as Record<string, unknown>)['_test'] = {
        nights: { one: '{count} νύχτα', other: '{count} νύχτες' },
      };
    });
    afterEach(() => {
      delete (DICTIONARIES.en as Record<string, unknown>)['_test'];
      delete (DICTIONARIES.el as Record<string, unknown>)['_test'];
    });

    it('picks the plural form for {count} in each language', () => {
      const i18n = create();
      expect(i18n.t('_test.nights', { count: 1 })).toBe('1 night');
      expect(i18n.t('_test.nights', { count: 3 })).toBe('3 nights');
      i18n.setLang('el');
      expect(i18n.t('_test.nights', { count: 1 })).toBe('1 νύχτα');
      expect(i18n.t('_test.nights', { count: 0 })).toBe('0 νύχτες');
    });

    it('falls back to English, then to the key (never a blank)', () => {
      const i18n = create('el');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(i18n.t('_test.onlyEnglish')).toBe('Only in English');
      expect(i18n.t('no.such.key')).toBe('no.such.key');
      expect(i18n.t('toolbar')).toBe('toolbar'); // a group, not a text
      expect(warn).toHaveBeenCalledWith('[i18n] missing text for "no.such.key"');
      warn.mockRestore();
    });
  });

  it('has() tells a text key from an unknown one (for route titles)', () => {
    const i18n = create();
    expect(i18n.has('titles.login')).toBe(true);
    expect(i18n.has('Some literal title')).toBe(false);
  });

  describe('Greek is loaded lazily (a separate chunk)', () => {
    let greek: typeof DICTIONARIES.el;
    beforeEach(() => {
      greek = DICTIONARIES.el;
      delete DICTIONARIES.el; // as in the app before Greek is first needed
    });
    afterEach(() => {
      DICTIONARIES.el = greek;
    });

    it('a switch loads it first, then changes the language', async () => {
      const i18n = create();
      const switching = i18n.setLang('el');
      expect(i18n.lang()).toBe('en'); // not yet - still loading
      await switching;
      expect(i18n.lang()).toBe('el');
      expect(i18n.t('toolbar.logIn')).toBe('Σύνδεση');
      expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('el');
    });

    it('a saved Greek choice: starts in English, ready() switches before the first render', async () => {
      const i18n = create('el');
      expect(i18n.lang()).toBe('en');
      await i18n.ready();
      expect(i18n.lang()).toBe('el');
      expect(i18n.t('toolbar.logIn')).toBe('Σύνδεση');
      expect(document.documentElement.lang).toBe('el');
    });

    it('clicking EN while Greek is still loading keeps English', async () => {
      const i18n = create();
      const slow = i18n.setLang('el');
      await i18n.setLang('en');
      await slow;
      expect(i18n.lang()).toBe('en');
    });
  });
});
