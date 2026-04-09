# GoTradeTalk Desktop Release Plan

## Current Packaging Baseline

- Desktop runtime: Tauri 2
- Frontend build: Vite `dist/`
- App name: `GoTradeTalk`
- Bundle identifier: `com.gotradetalk.desktop`
- Desktop version source of truth: `package.json` + `src-tauri/tauri.conf.json` + `src-tauri/Cargo.toml` all aligned to `0.1.0`
- Dev entry: `npm run tauri:dev`
- Release build entry: `npm run tauri:build`
- Updater release build entry: `npm run tauri:build:updater`

## Dev vs Build

### `npm run tauri:dev`

- Starts the Vite dev server through `beforeDevCommand`
- Tauri loads `build.devUrl` (`http://localhost:5173`)
- Uses hot reload for frontend changes
- Suitable for feature verification, not for release validation

### `npm run tauri:build`

- Runs `npm run build` through `beforeBuildCommand`
- Tauri bundles the built frontend from `dist/`
- Produces release binaries and platform installers under `src-tauri/target/release/bundle/`
- This is the command that validates desktop release readiness

### `npm run tauri:build:updater`

- Uses `src-tauri/tauri.updater.conf.json`
- Enables updater artifacts in addition to the normal installers
- Requires updater environment variables to be set for a real release workflow

## Minimal Release Path

1. Confirm production API endpoints in `.env` before running the build.
2. Run `npm run build`.
3. Run `npm run tauri:build`.
4. Verify the generated `.app`/`.dmg` on macOS and `.msi`/`.exe` on Windows.
5. Publish installers manually from a release channel.

### Manual upgrade flow

- User downloads the new installer from the release page
- Install over the existing app
- Keep release notes per version so support can guide upgrades

## Updater Readiness Gap

Current repository now includes the updater runtime skeleton, but it still lacks the release secrets and hosted metadata required for production updates.

The desktop app now includes an updater runtime skeleton:

- If updater env vars are missing, the packaged app runs normally and skips update checks
- If updater env vars are present, the packaged app checks once per session on startup
- When an update is found, the app prompts the user to download and restart
- `src-tauri/tauri.updater.conf.json` exists only to enable updater bundle artifacts during release builds

To enable Tauri updater safely, add the following:

1. Generate updater signing keys with `npm run tauri signer generate`.
2. Store the private key in CI secrets.
3. Set `TAURI_UPDATER_PUBKEY` at build time.
4. Set `TAURI_UPDATER_ENDPOINTS` at build time. Multiple endpoints can be comma-separated.
5. Set `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in CI for updater artifact signing.
6. Run `npm run tauri:build:updater`.
7. Publish `latest.json` plus signed updater artifacts for each target platform.

### Recommended version strategy

- Use SemVer: `MAJOR.MINOR.PATCH`
- Patch: packaging fix, UI bug fix, no release train change
- Minor: compatible feature release
- Major: breaking protocol, storage, or login behavior changes
- Keep Tauri app version identical across `package.json`, `tauri.conf.json`, and Cargo metadata

### Recommended release hosting

- Preferred: GitHub Releases or an object storage bucket behind HTTPS
- Required artifacts for updater: installers, `.sig` files, `latest.json`
- Keep separate channels if needed: `stable` first, `beta` later
- GitHub Releases first-pass workflow: see `docs/updater-github-releases.md`

### Build-time updater variables

```bash
export TAURI_UPDATER_PUBKEY='YOUR_MINISIGN_PUBLIC_KEY'
export TAURI_UPDATER_ENDPOINTS='https://releases.example.com/latest.json'
export TAURI_SIGNING_PRIVATE_KEY='YOUR_MINISIGN_PRIVATE_KEY'
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='YOUR_PRIVATE_KEY_PASSWORD'
npm run tauri:build:updater
```

Notes:

- `TAURI_UPDATER_PUBKEY` and `TAURI_UPDATER_ENDPOINTS` are compiled into the desktop app
- `TAURI_SIGNING_PRIVATE_KEY` is only needed when generating signed updater artifacts
- `npm run tauri:build:updater` will fail by design if a public key is configured but the signing private key is missing
- For fast iteration, host `latest.json` and artifacts on GitHub Releases or an HTTPS bucket

## Pre-release Checklist

### Must complete

- Production API base URL is explicit and correct
- Login works for the intended account types
- File upload works in packaged app
- File download/open path works in packaged app
- Release logs can be collected from the OS log directory
- App icon, app name, and version are correct in packaged output
- macOS package launches outside dev mode
- Windows installer/install path behavior is verified on a real Windows machine

### Should complete

- Add updater plugin and hosted metadata
- Add release signing/notarization pipeline
- Add release notes template per version
- Add smoke test script for packaged app install and first launch
- Decide stable release channel URL for updater

## Platform Notes

### macOS

- Building `.app` can work with Command Line Tools, but shipping signed/notarized binaries needs Apple signing assets and usually full Xcode tooling
- Notarization must be handled before broad distribution outside local testing

### Windows

- Validate NSIS/MSI output on a real Windows device
- Decide installer type before rollout: NSIS is usually better for Tauri updater flows, MSI is useful for enterprise deployment
