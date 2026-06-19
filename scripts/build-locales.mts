/**
 * Dev tool: turn translated JSON catalogs in /tmp/loc/<code>.json into
 * shared/src/locales/<code>.ts files, then regenerate the import block and the
 * CATALOGS map in shared/src/i18n.ts so the seeded locales activate.
 *
 * Values are emitted via JSON.stringify so any quotes / backslashes / unicode
 * escape correctly. Run with: npx tsx scripts/build-locales.mts
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/jalex/Source/BibDesk/bibdesk-electron';
const LOCALES_DIR = join(ROOT, 'shared/src/locales');
const I18N = join(ROOT, 'shared/src/i18n.ts');
const LOC_JSON = '/tmp/loc';

// code → JS identifier (zh-Hans → zhHans)
const ident = (code: string): string => code.replace(/-(\w)/g, (_m, c: string) => c.toUpperCase());

// Display names + order come from the LOCALES list in i18n.ts.
const i18nSrc = readFileSync(I18N, 'utf8');
const localeOrder: { code: string; name: string }[] = [];
for (const m of i18nSrc.matchAll(/\{ code: '([^']+)', name: '([^']+)' \}/g)) {
  localeOrder.push({ code: m[1]!, name: m[2]! });
}

// 1) Emit a .ts catalog for every JSON in /tmp/loc.
const jsonFiles = existsSync(LOC_JSON)
  ? readdirSync(LOC_JSON).filter((f) => f.endsWith('.json'))
  : [];
const EXISTING_JSON = '/tmp/existing';
for (const f of jsonFiles) {
  const code = f.replace(/\.json$/, '');
  const name = localeOrder.find((l) => l.code === code)?.name ?? code;
  const fresh = JSON.parse(readFileSync(join(LOC_JSON, f), 'utf8')) as Record<string, string>;
  // Where a curated/committed catalog already had a key, keep that value (it is
  // test-asserted and human-reviewed); the freshly-translated catalog only fills
  // the gaps.
  const existingPath = join(EXISTING_JSON, f);
  const existing = existsSync(existingPath)
    ? (JSON.parse(readFileSync(existingPath, 'utf8')) as Record<string, string>)
    : {};
  const obj = { ...fresh, ...existing };
  const body = Object.entries(obj)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join('\n');
  const ts =
    `/**\n * ${name} catalog — machine-seeded (best-effort); needs native review.\n` +
    ` * Overrides {@link en}; technical/proper-noun tokens fall back to English.\n */\n` +
    `import type { Catalog } from '../i18n.js';\n\n` +
    `export const ${ident(code)}: Catalog = {\n${body}\n};\n`;
  writeFileSync(join(LOCALES_DIR, `${code}.ts`), ts);
  console.log(`wrote ${code}.ts (${Object.keys(obj).length} keys)`);
}

// 2) Discover every catalog that now exists (a <code>.ts in locales/, code in LOCALES).
const present = localeOrder
  .map((l) => l.code)
  .filter((code) => existsSync(join(LOCALES_DIR, `${code}.ts`)));

// 3) Rewrite the import block: replace the entire consecutive run of locale
// imports with the regenerated set (idempotent — safe to re-run).
const imports = present.map((c) => `import { ${ident(c)} } from './locales/${c}.js';`).join('\n');
let out = i18nSrc.replace(
  /(?:import \{[^}]+\} from '\.\/locales\/[^']+\.js';\n)+/,
  imports + '\n',
);

// 4) Rewrite the CATALOGS map. The map KEY must be the exact locale code, so a
// hyphenated code (zh-Hans) needs an explicit `'zh-Hans': zhHans` entry — object
// shorthand would register it under the JS identifier 'zhHans' and never match.
const catEntries = present
  .map((c) => (ident(c) === c ? c : `'${c}': ${ident(c)}`))
  .join(', ');
out = out.replace(
  /const CATALOGS: Record<string, Catalog> = \{[^}]*\};/,
  `const CATALOGS: Record<string, Catalog> = { ${catEntries} };`,
);

writeFileSync(I18N, out);
console.log(`\nregistered ${present.length} catalogs: ${present.join(', ')}`);
