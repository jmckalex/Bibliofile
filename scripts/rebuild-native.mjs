/**
 * Rebuild the native better-sqlite3 addon for either the Node ABI (so `pnpm
 * test` can run the SQLite FTS5 tests) or the Electron ABI (so the packaged /
 * `pnpm dev` app can use full-text search). One binary, two ABIs — switch with:
 *
 *   node scripts/rebuild-native.mjs node       # for tests / CI
 *   node scripts/rebuild-native.mjs electron    # for the app (default)
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
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const target = (process.argv[2] ?? 'electron').toLowerCase();
const require = createRequire(resolve(root, 'app/index.js'));

const bsDir = dirname(require.resolve('better-sqlite3/package.json'));
const nodeGyp = resolve(
  process.execPath,
  '../../lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js',
);

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
    `--arch=${process.arch}`,
    '--dist-url=https://electronjs.org/headers',
  );
  console.log(`Rebuilding better-sqlite3 for Electron ${electronVersion} (${process.arch})…`);
} else {
  console.log(`Rebuilding better-sqlite3 for Node ${process.versions.node}…`);
}

execFileSync(process.execPath, [nodeGyp, ...args], { cwd: bsDir, env, stdio: 'inherit' });
console.log('Done.');
