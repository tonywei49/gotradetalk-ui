# GitHub Releases Updater Flow

## Goal

Use GitHub Releases as the first updater backend for the GoTradeTalk desktop app.

## Release Artifacts

After a successful updater build, upload these files to the GitHub Release for the version:

- Normal installers:
  - macOS `.dmg`
  - Windows `.msi` or `-setup.exe`
- Updater artifacts:
  - macOS `.app.tar.gz`
  - Windows `.msi.zip` or `-setup.exe.zip`
- Signature files:
  - one `.sig` file per updater artifact
- Metadata:
  - `latest.json`

Example macOS files:

- `GoTradeTalk_0.1.0_aarch64.dmg`
- `GoTradeTalk.app.tar.gz`
- `GoTradeTalk.app.tar.gz.sig`
- `latest.json`

## Required Environment Variables

```bash
export TAURI_UPDATER_PUBKEY='YOUR_MINISIGN_PUBLIC_KEY'
export TAURI_UPDATER_ENDPOINTS='https://github.com/<owner>/<repo>/releases/latest/download/latest.json'
export TAURI_SIGNING_PRIVATE_KEY='YOUR_MINISIGN_PRIVATE_KEY'
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='YOUR_PRIVATE_KEY_PASSWORD'
```

Notes:

- `TAURI_UPDATER_ENDPOINTS` should point to a directly downloadable `latest.json`
- GitHub Releases `latest/download/...` works if you always want the latest stable version
- If you need staged rollout later, switch to versioned JSON on object storage

## Build Command

```bash
npm run tauri:build:updater
```

This should generate updater artifacts such as:

- `src-tauri/target/release/bundle/macos/GoTradeTalk.app.tar.gz`
- `src-tauri/target/release/bundle/macos/GoTradeTalk.app.tar.gz.sig`

## Generate `latest.json`

```bash
export UPDATER_VERSION='0.1.0'
export UPDATER_BASE_URL='https://github.com/<owner>/<repo>/releases/download/v0.1.0'
export UPDATER_NOTES='Bug fixes and packaging improvements.'
npm run tauri:manifest
```

Default output:

- `src-tauri/target/release/bundle/latest.json`

Optional overrides:

```bash
export UPDATER_BUNDLE_DIR='src-tauri/target/release/bundle'
export UPDATER_OUTPUT='release/latest.json'
export UPDATER_PUB_DATE='2026-03-09T14:30:00Z'
```

## Expected `latest.json`

```json
{
  "version": "0.1.0",
  "notes": "Bug fixes and packaging improvements.",
  "pub_date": "2026-03-09T14:30:00Z",
  "platforms": {
    "darwin-aarch64-app": {
      "url": "https://github.com/<owner>/<repo>/releases/download/v0.1.0/GoTradeTalk.app.tar.gz",
      "signature": "<contents of GoTradeTalk.app.tar.gz.sig>"
    }
  }
}
```

## Release Steps

1. Update app version.
2. Build updater artifacts with signing env vars.
3. Generate `latest.json`.
4. Create GitHub Release `vX.Y.Z`.
5. Upload installers, updater artifacts, `.sig`, and `latest.json`.
6. Install the previous desktop version locally.
7. Launch the app and verify it detects the new version and upgrades successfully.

## Important Constraints

- The updater public key must remain stable across releases.
- If the private key changes, old clients will stop trusting new updates.
- macOS updater does not replace Apple signing/notarization. You still need normal macOS release signing.
- For Windows updater, prefer NSIS if you want the smoothest updater path.
