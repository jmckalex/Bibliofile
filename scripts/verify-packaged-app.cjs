// electron-builder afterPack hook: refuse to sign, notarize or ship a bundle whose
// runtime modules don't load.
//
// Runs scripts/packaged-app-probe.cjs with the packaged app's OWN Electron binary
// in Node mode, so it resolves modules through the bundle's asar exactly as the
// launched app does. afterPack runs before signing, so a failure here stops the
// build before Apple's notary queue is ever involved.
//
// The failure it exists for: 0.12.0 passed codesign, spctl and stapler, had
// tesseract.js visibly present in app.asar.unpacked — and crashed on launch with
// "Cannot find module 'regenerator-runtime/runtime'". electron-builder 24 packs only
// app/package.json's DIRECT dependencies out of pnpm's layout, not their own deps
// (see the comment above `files:` in electron-builder.yml).
// app/src/main/packaged-deps.test.ts checks the same rule from source in CI; this is
// the check against the real artifact.
//
// Also usable by hand against any built app, e.g. an installed one:
//   node scripts/verify-packaged-app.cjs /Applications/Bibliofile.app
//
// Must be CommonJS (.cjs) because the root package.json is `type: module`.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROBE = path.join(__dirname, 'packaged-app-probe.cjs');

/**
 * The probe's environment is an allowlist, NOT a copy of ours. pnpm's bin shim for
 * electron-builder exports NODE_PATH=…/node_modules/.pnpm/node_modules — pnpm's
 * hidden hoist of the whole dev tree — so an inherited environment lets a module
 * missing from the bundle resolve from the checkout instead, and the probe passes a
 * bundle that cannot launch. (Verified: with tslib dropped from the bundle, the
 * probe reported pdf-lib "ok" under `pnpm exec electron-builder` and FAIL by hand.)
 * NODE_OPTIONS can inject modules the same way. The launched app gets neither.
 */
function probeEnv() {
  const env = { ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
  for (const key of ['HOME', 'TMPDIR', 'USER', 'LANG']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

/** Run the probe inside `appBundle` (a macOS .app). Returns true when everything loads. */
function verifyMacApp(appBundle, executableName) {
  const exe = path.join(appBundle, 'Contents', 'MacOS', executableName);
  const resources = path.join(appBundle, 'Contents', 'Resources');
  const r = spawnSync(exe, [PROBE, resources], {
    env: probeEnv(),
    stdio: 'inherit',
    timeout: 120_000,
  });
  if (r.error) throw r.error;
  return r.status === 0;
}

exports.default = async function verifyPackagedApp(context) {
  const { electronPlatformName, appOutDir, arch } = context;
  // The probe has to execute the packaged binary, so it can only run for a macOS
  // build made on a Mac (an x64 build on Apple Silicon runs under Rosetta).
  if (electronPlatformName !== 'darwin' || process.platform !== 'darwin') {
    console.log(
      `[verify] ${electronPlatformName} build on ${process.platform} — skipping load check.`,
    );
    return;
  }
  const name = context.packager.appInfo.productFilename;
  // `arch` is electron-builder's numeric Arch enum (builder-util).
  const archName = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][arch] ?? arch;
  console.log(`[verify] loading runtime modules inside ${name}.app (${archName})…`);
  if (!verifyMacApp(path.join(appOutDir, `${name}.app`), name)) {
    throw new Error(
      `[verify] ${name}.app cannot load its own runtime modules — refusing to continue. ` +
        'A module missing here is almost always a transitive dependency of an ' +
        'externalized package that is not declared in app/package.json.',
    );
  }
};

if (require.main === module) {
  const appBundle = process.argv[2];
  if (!appBundle || !appBundle.endsWith('.app')) {
    console.error('usage: node scripts/verify-packaged-app.cjs <path/to/Bibliofile.app>');
    process.exit(2);
  }
  process.exit(verifyMacApp(path.resolve(appBundle), path.basename(appBundle, '.app')) ? 0 : 1);
}
