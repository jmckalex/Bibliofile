/**
 * Guards what the PACKAGED app can load. 0.12.0 was signed, notarized, stapled and
 * crashed on launch:
 *
 *   Error: Cannot find module 'regenerator-runtime/runtime'
 *   Require stack: - …/app.asar/node_modules/tesseract.js/src/index.js
 *
 * The main bundle leaves a few packages out (`external` in electron.vite.config.ts,
 * plus `better-sqlite3`, which is `createRequire`d where rollup can't see it), so
 * they must ship as real modules. electron-builder 24 collects only the app's DIRECT
 * dependencies out of pnpm's layout: a package's own deps sit beside it under
 * node_modules/.pnpm and are silently left out. Nothing fails at build time; the
 * first symptom is the crash dialog.
 *
 * So the rule is: every runtime dependency of an externalized package, all the way
 * down, is declared in app/package.json — at the SAME version its parent resolves,
 * because in the packaged app there is only one copy, the app's. (0.12.0 also
 * shipped tesseract.js-core 6 under tesseract.js 7, whose Node worker require()s
 * the relaxed-SIMD core that only 7 has — OCR would have failed even without the
 * crash.) This walks the installed tree and checks exactly that.
 *
 * It models electron-builder; scripts/verify-packaged-app.cjs (the afterPack hook)
 * checks the real bundle by loading the modules inside it.
 */
import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const appDir = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const mainDir = fileURLToPath(new URL('./', import.meta.url));

interface PackageJson {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
const readPkg = (dir: string): PackageJson =>
  JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson;

const appPkg = readPkg(appDir);
const declared = new Set([
  ...Object.keys(appPkg.dependencies ?? {}),
  ...Object.keys(appPkg.optionalDependencies ?? {}),
]);

/** Dependencies only ever run at INSTALL time, so never needed in the bundle. */
const INSTALL_TIME_ONLY: Record<string, string> = {
  // tesseract.js's postinstall funding banner — and allowBuilds disables it anyway.
  'opencollective-postinstall': 'tesseract.js postinstall',
  // better-sqlite3's install script; rebuild-native.mjs builds it for Electron.
  'prebuild-install': 'better-sqlite3 install script',
};

/**
 * Parent>child pairs where the packaged app may resolve a different version than
 * dev does. Each needs a reason it is safe.
 */
const ALLOWED_SKEW: Record<string, string> = {
  // pdfjs-dist 4 declares @napi-rs/canvas ^0.1 as an OPTIONAL dep, used only to
  // polyfill DOMMatrix/ImageData/Path2D (ocr.ts sets those globals from the app's
  // own canvas first) and for its fallback canvas factory, all behind try/catch.
  // Packaged, it resolves the app's 1.x — one native skia binary instead of two.
  'pdfjs-dist>@napi-rs/canvas': 'optional, polyfill-only',
};

/** Package name from a bare specifier: `@scope/pkg/sub/path` → `@scope/pkg`. */
const packageName = (spec: string): string =>
  spec
    .split('/')
    .slice(0, spec.startsWith('@') ? 2 : 1)
    .join('/');

/** Node's lookup: `<dir>/node_modules/<name>`, then each ancestor. Real path, or null. */
function resolveInstalled(name: string, fromDir: string): string | null {
  for (let d = fromDir; ; d = dirname(d)) {
    const candidate = join(d, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(d) === d) return null;
  }
}

/** The packages the bundled main process loads from node_modules at runtime. */
function runtimeRoots(): string[] {
  const viteConfig = readFileSync(join(appDir, 'electron.vite.config.ts'), 'utf8');
  const lists = [...viteConfig.matchAll(/\bexternal:\s*\[([^\]]*)\]/g)];
  expect(lists, 'expected exactly one `external: [...]` in electron.vite.config.ts').toHaveLength(
    1,
  );
  const externals = [...lists[0]![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);

  // createRequire()d at runtime — invisible to rollup, so never bundled either.
  const builtins = new Set(builtinModules);
  const required: string[] = [];
  for (const file of readdirSync(mainDir, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    if (file.includes('__fixtures__')) continue;
    const src = readFileSync(join(mainDir, file), 'utf8');
    for (const m of src.matchAll(/\brequire(?:\.resolve)?\(\s*'([^'./][^']*)'\s*\)/g)) {
      const name = packageName(m[1]!);
      if (!builtins.has(name) && !name.startsWith('node:') && name !== 'electron') {
        required.push(name);
      }
    }
  }
  return [...new Set([...externals, ...required])].sort();
}

interface Walk {
  roots: string[];
  visited: Set<string>;
  undeclared: string[];
  skewed: string[];
  notInstalled: string[];
}

function walkRuntimeClosure(): Walk {
  const roots = runtimeRoots();
  const out: Walk = { roots, visited: new Set(), undeclared: [], skewed: [], notInstalled: [] };
  const queue: { name: string; from: string; chain: string[]; optional: boolean }[] = roots.map(
    (name) => ({ name, from: appDir, chain: ['app'], optional: false }),
  );
  while (queue.length) {
    const { name, from, chain, optional } = queue.shift()!;
    if (name in INSTALL_TIME_ONLY) continue;
    const via = chain.join(' > ');
    const dir = resolveInstalled(name, from);
    if (!dir) {
      // An optional dep for another platform/arch is legitimately absent.
      if (!optional) out.notInstalled.push(`${name} (${via})`);
      continue;
    }
    const pkg = readPkg(dir);
    const parent = chain[chain.length - 1]!;
    if (!declared.has(name)) {
      // Once per package, via the first (shortest) chain that needs it.
      if (!out.undeclared.some((u) => u.startsWith(`${name}@${pkg.version} `))) {
        out.undeclared.push(`${name}@${pkg.version} (${via})`);
      }
    } else {
      // The packaged app holds one copy: the one the app itself resolves.
      const appCopy = resolveInstalled(name, appDir);
      const appVersion = appCopy ? readPkg(appCopy).version : '(none)';
      if (appVersion !== pkg.version) {
        if (`${parent}>${name}` in ALLOWED_SKEW) continue; // the app's copy is walked as a root
        out.skewed.push(`${name}: ${parent} needs ${pkg.version}, app ships ${appVersion}`);
      }
    }
    if (out.visited.has(dir)) continue;
    out.visited.add(dir);
    const next = [...chain, name];
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      queue.push({ name: dep, from: dir, chain: next, optional: false });
    }
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
      queue.push({ name: dep, from: dir, chain: next, optional: true });
    }
  }
  return out;
}

describe('packaged runtime dependencies', () => {
  const walk = walkRuntimeClosure();

  it('finds the packages the main process loads at runtime', () => {
    // Pins the two discovery paths, so a regex that stops matching can't make the
    // rest of this file pass vacuously: the vite `external` list, and createRequire.
    expect(walk.roots).toEqual(
      expect.arrayContaining(['tesseract.js', 'pdf-lib', '@napi-rs/canvas', 'pdfjs-dist']),
    );
    expect(walk.roots, 'better-sqlite3 is createRequire()d, not imported').toContain(
      'better-sqlite3',
    );
    // ~25 today (roots + regenerator-runtime, node-fetch > whatwg-url, pako, …).
    expect(walk.visited.size).toBeGreaterThan(20);
  });

  it('declares every one of their runtime dependencies in app/package.json', () => {
    // electron-builder 24 packs only app/package.json's direct dependencies. Each
    // entry below is a module the packaged app will fail to find — add it to
    // app/package.json `dependencies` with the range its parent asks for.
    expect(walk.undeclared).toEqual([]);
    expect(walk.notInstalled).toEqual([]);
  });

  it('ships the version each of them actually resolves in dev', () => {
    // A mismatch means dev/tests run one version and the packaged app another.
    expect(walk.skewed).toEqual([]);
  });
});
