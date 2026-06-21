// electron-builder afterAllArtifactBuild hook: sign + notarize + staple each .dmg.
//
// The afterSign hook (scripts/notarize.cjs) notarizes + staples the .app — which
// is what the auto-update .zip needs. But electron-builder then wraps that .app
// into a .dmg *afterward*, and it does NOT code-sign or notarize the dmg
// container itself. A bare notarized-but-unsigned dmg still opens (Gatekeeper
// honours the stapled ticket), but `spctl` can't assess an unsigned dmg, so it
// reports a confusing "rejected / no usable signature". Code-signing the dmg too
// makes the verdict an unambiguous "accepted / Notarized Developer ID".
//
// So for each built .dmg this hook:
//   1. codesigns it with the Developer ID Application cert (auto-discovered from
//      the login keychain, preferring the one matching APPLE_TEAM_ID),
//   2. submits it to Apple's notary service (a separate ticket from the app —
//      different cdhash),
//   3. staples the ticket so it validates offline.
//
// Must be CommonJS (.cjs) because the root package.json is `type: module`.
// Self-skips unless the Apple credentials are present, matching notarize.cjs:
//
//   APPLE_ID                      Apple ID of the Developer account
//   APPLE_APP_SPECIFIC_PASSWORD   app-specific password (or APPLE_APP_PASSWORD)
//   APPLE_TEAM_ID                 10-char Team ID (QC883N4FQC)
//
// Signing is skipped (notarize-only) if CSC_IDENTITY_AUTO_DISCOVERY=false or no
// Developer ID Application cert is found — the build still succeeds.

const { execFileSync } = require('node:child_process');

/** SHA-1 of the "Developer ID Application" cert, preferring one for `teamId`. */
function findDeveloperIdApplication(teamId) {
  let out;
  try {
    out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
    });
  } catch {
    return null;
  }
  // Lines look like:  1) <40-hex SHA1> "Developer ID Application: Name (TEAMID)"
  const candidates = out
    .split('\n')
    .filter((l) => l.includes('Developer ID Application'))
    .map((l) => {
      const m = l.match(/\)\s+([0-9A-Fa-f]{40})\s+"([^"]+)"/);
      return m ? { hash: m[1], name: m[2] } : null;
    })
    .filter(Boolean);
  if (candidates.length === 0) return null;
  const preferred =
    (teamId && candidates.find((c) => c.name.includes(`(${teamId})`))) || candidates[0];
  return preferred.hash;
}

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

  // Discover the signing identity (skipped if dev forced auto-discovery off).
  const identity =
    process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false'
      ? null
      : findDeveloperIdApplication(teamId);
  if (!identity) {
    console.log(
      '[notarize-dmg] no Developer ID Application cert found (or auto-discovery off) — notarizing the dmg without code-signing it.',
    );
  }

  for (const dmg of dmgs) {
    if (identity) {
      console.log(`[notarize-dmg] code-signing ${dmg}…`);
      execFileSync('codesign', ['--sign', identity, '--timestamp', '--force', dmg], {
        stdio: 'inherit',
      });
    }

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
