/**
 * Rebuild the native better-sqlite3 addon for either the Node ABI (so `pnpm
 * test` can run the SQLite FTS5 tests) or the Electron ABI (so the packaged /
 * `pnpm dev` app can use full-text search). One binary, two ABIs — switch with:
 *
 *   node scripts/rebuild-native.mjs node            # for tests / CI
 *   node scripts/rebuild-native.mjs electron         # for the app (default, host arch)
 *   node scripts/rebuild-native.mjs electron x64     # cross-compile for Intel
 *   node scripts/rebuild-native.mjs electron arm64   # cross-compile for Apple Silicon
 *
 * The optional 3rd arg cross-compiles the addon for a non-host arch (used by the
 * `dist:mac:x64` script to ship an Intel build from an Apple Silicon machine).
 * It leaves node_modules holding that arch's binary, so re-run for the host arch
 * (`electron` / `node`) afterwards before `pnpm dev`/`pnpm test`.
 *
 * Notes:
 * - On a clean machine, `npx @electron/rebuild -w better-sqlite3` is the
 *   canonical tool; this script is a dependency-free equivalent that also works
 *   around an Anaconda `libtool`/`ar` on PATH shadowing Xcode's (it forces the
 *   system toolchain). It downloads Electron headers on the `electron` target.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const target = (process.argv[2] ?? 'electron').toLowerCase();
// Optional cross-compile arch (defaults to the host); only meaningful for `electron`.
const arch = (process.argv[3] ?? process.arch).toLowerCase();
const require = createRequire(resolve(root, 'app/index.js'));

const bsDir = dirname(require.resolve('better-sqlite3/package.json'));

// Locate npm's bundled node-gyp. The relative path from the node binary varies
// by install layout (Homebrew moved npm under `libexec/lib`), so probe the
// known candidates instead of assuming one.
const nodeGyp = [
  resolve(process.execPath, '../../lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js'),
  resolve(
    process.execPath,
    '../../libexec/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js',
  ),
].find((p) => existsSync(p));
if (!nodeGyp) {
  console.error('Could not locate npm’s bundled node-gyp. Try: npx @electron/rebuild -w better-sqlite3');
  process.exit(1);
}

// Prefer the system toolchain (Xcode libtool/ar/clang) over any Anaconda shims.
const env = {
  ...process.env,
  PATH: `/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH ?? ''}`,
  npm_config_python: '/usr/bin/python3',
};

const args = ['rebuild', '--release'];
if (target === 'electron') {
  const electronVersion = require('electron/package.json').version;
  args.push(
    `--target=${electronVersion}`,
    `--arch=${arch}`,
    '--dist-url=https://electronjs.org/headers',
  );
  const cross = arch !== process.arch ? ` [cross-compiling from ${process.arch}]` : '';
  console.log(`Rebuilding better-sqlite3 for Electron ${electronVersion} (${arch})${cross}…`);
} else {
  console.log(`Rebuilding better-sqlite3 for Node ${process.versions.node}…`);
}

execFileSync(process.execPath, [nodeGyp, ...args], { cwd: bsDir, env, stdio: 'inherit' });
console.log('Done.');
