// TICKET-038: every text key the code uses must exist in en.json (and so,
// thanks to dictionaries.spec.ts, in el.json too).
//
//   npm run check:i18n
//
// Finds literal keys in templates and TypeScript:
//   'toolbar.logIn' | t          t('...')  translate('...')  setKey('...')
//   i18n.t('...')                label: 'listings.sort.newest'
// Keys built at run time ('status.' + b.status, `amenities.${key}`) can't be
// checked here; the dictionaries spec and the page tests cover those.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../src/app/', import.meta.url).pathname;
const en = JSON.parse(readFileSync(join(root, 'core/i18n/en.json'), 'utf8'));

function has(key) {
  let node = en;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false;
    node = node[part];
  }
  return true;
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(ts|html)$/.test(name) && !name.endsWith('.spec.ts')) yield path;
  }
}

const patterns = [
  /'([a-zA-Z][\w]*(?:\.[\w]+)+)'\s*\|\s*t\b/g, // 'a.b' | t
  /\b(?:t|translate|setKey)\(\s*'([a-zA-Z][\w]*(?:\.[\w]+)+)'/g, // t('a.b'), translate('a.b'), setKey('a.b')
  /\blabel:\s*'([a-zA-Z][\w]*(?:\.[\w]+)+)'/g, // label: 'a.b' (option lists)
];

const missing = [];
let used = 0;
for (const file of files(root)) {
  const text = readFileSync(file, 'utf8');
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      used++;
      if (!has(m[1])) missing.push(`${relative(root, file)}: ${m[1]}`);
    }
  }
}

if (missing.length) {
  console.error(`Missing in en.json (${missing.length}):\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(`i18n: all ${used} literal key uses exist in en.json.`);
