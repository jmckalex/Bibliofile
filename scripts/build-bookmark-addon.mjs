/**
 * Build the macOS bookmark-data addon (`app/native/bookmark`) for either ABI:
 *
 *   node scripts/build-bookmark-addon.mjs node             # for `pnpm test`
 *   node scripts/build-bookmark-addon.mjs electron          # for the app (default)
 *   node scripts/build-bookmark-addon.mjs electron x64      # cross-compile
 *
 * Same shape as `rebuild-native.mjs` (which does this for better-sqlite3): probe
 * for npm's bundled node-gyp, force the system toolchain so an Anaconda
 * libtool/ar on PATH can't shadow Xcode's, and pass Electron headers when
 * targeting the app.
 *
 * UNLIKE better-sqlite3, this addon is written against Node-API, which is
 * ABI-STABLE across both Node and Electron — one built binary works in both, so
 * there is no rebuild-before-test / rebuild-after dance and the tests never skip
 * once it exists. The `node` target is still worth having for CI, where fetching
 * Electron headers is undesirable.
 *
 * No-op with a clear message on non-macOS: the addon wraps Foundation, and
 * everything that uses it degrades to writing portable `relativePath`-only
 * attachments (see app/src/main/bookmark.ts).
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const target = (process.argv[2] ?? 'electron').toLowerCase();
const arch = process.argv[3] ?? process.arch;

if (process.platform !== 'darwin') {
  console.log('Not macOS — skipping the bookmark addon (attachments stay relativePath-only).');
  process.exit(0);
}

const require = createRequire(resolve(root, 'app/index.js'));
const addonDir = resolve(root, 'app/native/bookmark');

const nodeGyp = [
  resolve(process.execPath, '../../lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js'),
  resolve(
    process.execPath,
    '../../libexec/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js',
  ),
].find((p) => existsSync(p));
if (!nodeGyp) {
  console.error('Could not locate npm’s bundled node-gyp.');
  process.exit(1);
}

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
  console.log(`Building bookmark addon for Electron ${electronVersion} (${arch})…`);
} else {
  console.log(`Building bookmark addon for Node ${process.versions.node}…`);
}

execFileSync(process.execPath, [nodeGyp, ...args], { cwd: addonDir, env, stdio: 'inherit' });
console.log('Done.');
