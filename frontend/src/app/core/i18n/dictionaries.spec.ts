import { DICTIONARIES, Dictionary, LANGUAGES } from './translation.service';

/** Every text in a dictionary as `path -> text` (plural forms are `key.one`, `key.other`). */
function flatten(dict: Dictionary, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe('en.json / el.json (TICKET-038)', () => {
  const en = flatten(DICTIONARIES.en);
  const el = flatten(DICTIONARIES.el);

  it('have exactly the same keys - no missing Greek, no leftovers', () => {
    const missingInGreek = [...en.keys()].filter((k) => !el.has(k));
    const onlyInGreek = [...el.keys()].filter((k) => !en.has(k));
    expect(missingInGreek).toEqual([]);
    expect(onlyInGreek).toEqual([]);
  });

  it('use the same {placeholders} for every key', () => {
    const mismatched = [...en.keys()].filter((k) => placeholders(en.get(k)!).join() !== placeholders(el.get(k) ?? '').join());
    expect(mismatched).toEqual([]);
  });

  it('keep the same HTML tags (texts shown with [innerHTML], e.g. <strong>)', () => {
    const tags = (text: string) => [...text.matchAll(/<\/?[a-z]+>/g)].map((m) => m[0]).join('');
    const mismatched = [...en.keys()].filter((k) => tags(en.get(k)!) !== tags(el.get(k) ?? ''));
    expect(mismatched).toEqual([]);
  });

  it('have no empty texts', () => {
    for (const lang of LANGUAGES) {
      const empty = [...flatten(DICTIONARIES[lang])].filter(([, text]) => !text.trim()).map(([k]) => k);
      expect(empty, lang).toEqual([]);
    }
  });

  it('give every plural an "other" form', () => {
    const pluralForms = /\.(zero|one|two|few|many|other)$/;
    for (const lang of LANGUAGES) {
      const dict = flatten(DICTIONARIES[lang]);
      const plurals = new Set([...dict.keys()].filter((k) => pluralForms.test(k)).map((k) => k.replace(pluralForms, '')));
      const withoutOther = [...plurals].filter((p) => !dict.has(`${p}.other`));
      expect(withoutOther, lang).toEqual([]);
    }
  });
});
