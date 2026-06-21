// electron-builder afterAllArtifactBuild hook: notarize + staple each .dmg.
//
// The afterSign hook (scripts/notarize.cjs) notarizes + staples the .app — which
// is what the auto-update .zip needs. But electron-builder then wraps that .app
// into a .dmg *afterward*, so the .dmg container has no notarization ticket of
// its own (`spctl --assess --type open` → rejected). A tester who downloads the
// quarantined .dmg would hit a Gatekeeper warning when opening the disk image.
//
// This hook runs after ALL artifacts are built, submits each .dmg to Apple's
// notary service (a separate ticket from the app — they have different cdhashes),
// then staples it so the .dmg validates offline. Net result: both the .app
// (inside the .zip) and the .dmg are notarized + stapled.
//
// Must be CommonJS (.cjs) because the root package.json is `type: module`.
// Self-skips unless the Apple credentials are present, matching notarize.cjs:
//
//   APPLE_ID                      Apple ID of the Developer account
//   APPLE_APP_SPECIFIC_PASSWORD   app-specific password (or APPLE_APP_PASSWORD)
//   APPLE_TEAM_ID                 10-char Team ID (QC883N4FQC)

const { execFileSync } = require('node:child_process');

exports.default = async function afterAllArtifactBuild(buildResult) {
  const dmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith('.dmg'));
  if (dmgs.length === 0) return [];

  const appleId = process.env.APPLE_ID;
  const password =
    process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_APP_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  // No credentials → leave the .dmg signed-but-not-notarized (or unsigned).
  if (!appleId || !password || !teamId) {
    console.log(
      '[notarize-dmg] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not all set — skipping .dmg notarization.',
    );
    return [];
  }

  for (const dmg of dmgs) {
    console.log(`[notarize-dmg] submitting ${dmg} to Apple notary service…`);
    execFileSync(
      'xcrun',
      [
        'notarytool',
        'submit',
        dmg,
        '--apple-id',
        appleId,
        '--password',
        password,
        '--team-id',
        teamId,
        '--wait',
      ],
      { stdio: 'inherit' },
    );

    console.log(`[notarize-dmg] notarization accepted — stapling ${dmg}…`);
    execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' });
  }

  console.log('[notarize-dmg] done.');
  return [];
};
