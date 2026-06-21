# Code signing + notarization (macOS)

How to produce a **signed + notarized** Bibliofile build that opens on other
people's Macs without the "unidentified developer" / "damaged" Gatekeeper block.

## One-time setup (already done on this machine)

1. **Developer ID Application certificate** — issued from your Apple Developer
   account and installed in the **login keychain**. Verify it's there:

   ```sh
   security find-identity -v -p codesigning | grep "Developer ID Application"
   # → "Developer ID Application: Jason Alexander (QC883N4FQC)"
   ```

   electron-builder finds this automatically — `electron-builder.yml` sets **no**
   `mac.identity`, so it auto-discovers the Developer ID cert from the keychain.

2. **App-specific password** for notarization (the notary service won't take your
   normal Apple ID password):
   - Sign in at <https://appleid.apple.com> → **Sign-In and Security** →
     **App-Specific Passwords** → **+** → name it e.g. `bibliofile-notarize`.
   - Copy the `xxxx-xxxx-xxxx-xxxx` value — you can't see it again.

## Building a signed + notarized release

Set three environment variables and run the mac dist script. On this machine
these are already exported from the shell profile (shared with Folio), so a bare
`pnpm dist:mac` notarizes automatically:

```sh
APPLE_ID=j.mckenzie.alexander@mac.com \
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx \
APPLE_TEAM_ID=QC883N4FQC \
pnpm dist:mac
```

(The hook also accepts `APPLE_APP_PASSWORD` as a fallback name for the password.)

What happens, in order:

1. `pnpm dist:mac` rebuilds `better-sqlite3` for the Electron ABI, runs the
   electron-vite build, then invokes electron-builder.
2. electron-builder **code-signs** `Bibliofile.app` with the Developer ID cert
   (hardened runtime + `build/entitlements.mac.plist`).
3. The **afterSign hook** (`scripts/notarize.cjs`) uploads the signed app to
   Apple's notary service, waits for the ticket, then `xcrun stapler staple`s it.
4. Output lands in `release/` (`Bibliofile-<version>-arm64.dmg` / `.zip`).

The hook **self-skips** if any of `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` /
`APPLE_TEAM_ID` is unset — so a plain `pnpm dist:mac` without the env vars
produces a signed-but-not-notarized build, and `pnpm pack:dir`
(`CSC_IDENTITY_AUTO_DISCOVERY=false`) produces a fast **unsigned** dev build with
no keychain prompt.

## Verifying the result

```sh
# Signed with the Developer ID cert?
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/Bibliofile.app"

# Notarization ticket stapled + Gatekeeper accepts it?
spctl --assess --type execute --verbose "release/mac-arm64/Bibliofile.app"
xcrun stapler validate "release/mac-arm64/Bibliofile.app"
```

## Credentials — keep them out of git

The `APPLE_*` values are secrets; never commit them. Pass them on the command
line (as above), keep them in a shell-local `.envrc` that's gitignored, or store
the app-specific password in the keychain and export it at build time. Only the
**Team ID** (`QC883N4FQC`) is non-secret and is baked into `scripts/notarize.cjs`
as the bundle's team.

## The moving parts (for reference)

| Piece | Role |
| --- | --- |
| `electron-builder.yml` → `mac.hardenedRuntime: true` + `entitlements` | required for notarization |
| `electron-builder.yml` → no `mac.identity` | auto-discover the Developer ID cert |
| `electron-builder.yml` → `mac.notarize: false` | electron-builder's own notarize off; our hook owns it |
| `electron-builder.yml` → `afterSign: scripts/notarize.cjs` | runs notarize + staple after signing |
| `scripts/notarize.cjs` | `@electron/notarize` call, `appBundleId: com.jmckalex.bibliofile`, stapler |
| `build/entitlements.mac.plist` | hardened-runtime entitlements (incl. unsigned-mem / dylib-env for the asar-unpacked native module) |
