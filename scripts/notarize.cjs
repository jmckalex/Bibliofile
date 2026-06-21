// electron-builder afterSign hook: notarize + staple the macOS app.
//
// Runs after electron-builder code-signs the .app (Developer ID Application
// cert, auto-discovered from the login keychain). Submits the signed bundle to
// Apple's notary service, waits for the ticket, then staples it so Gatekeeper
// accepts the app offline.
//
// Must be CommonJS (.cjs) because the root package.json is `type: module`.
//
// Skipped automatically unless all three Apple credentials are present in the
// environment, so unsigned/dev builds (`pnpm pack:dir`) never hit Apple:
//
//   APPLE_ID                      Apple ID email of the Developer account
//   APPLE_APP_SPECIFIC_PASSWORD   app-specific password (appleid.apple.com →
//   (or APPLE_APP_PASSWORD)       Sign-In and Security → App-Specific
//                                 Passwords), NOT the login password
//   APPLE_TEAM_ID                 10-char Team ID (QC883N4FQC)
//
// The password is read from APPLE_APP_SPECIFIC_PASSWORD first (the name used in
// this machine's shell profile, shared with Folio), falling back to
// APPLE_APP_PASSWORD.
//
// Run a full signed+notarized build with:
//   APPLE_ID=you@example.com APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx \
//     APPLE_TEAM_ID=QC883N4FQC pnpm dist:mac

const { notarize } = require('@electron/notarize');
const { execFileSync } = require('node:child_process');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appPassword =
    process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_APP_PASSWORD;

  // No credentials → leave the build signed-but-not-notarized (or unsigned).
  if (!process.env.APPLE_ID || !appPassword || !process.env.APPLE_TEAM_ID) {
    console.log(
      '[notarize] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not all set — skipping notarization.',
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`[notarize] submitting ${appName}.app to Apple notary service…`);
  await notarize({
    appBundleId: 'com.jmckalex.bibliofile',
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: appPassword,
    teamId: process.env.APPLE_TEAM_ID,
  });

  // Staple the ticket so the app validates without a network round-trip.
  console.log('[notarize] notarization accepted — stapling ticket…');
  execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' });
  console.log('[notarize] done.');
};
