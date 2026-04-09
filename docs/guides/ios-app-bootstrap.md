# GoTradeTalk iOS App Bootstrap

## Recommended path

Use Tauri 2 iOS first instead of rewriting with React Native or Flutter.

Why this is the right first step for this repo:

- The app is already a `Vite + React + TypeScript` SPA.
- The project already has a `src-tauri` shell and Tauri 2 dependencies.
- Existing native HTTP bridging can be reused to avoid WebView CORS issues on iOS.
- Desktop-only behaviors can now be gated away from iOS runtime.

This gets an installable iOS app faster, while keeping almost all current frontend code.

## What was prepared

- Added shared runtime detection for `web`, `tauri-desktop`, and `tauri-mobile`.
- Limited desktop-only updater and window lifecycle logic to desktop runtime.
- Reused the native HTTP bridge for all Tauri runtimes, including iOS.
- Added `TAURI_DEV_HOST` support to `vite.config.ts` so `tauri ios dev` can expose the dev server to a real device.
- Added `src-tauri/tauri.ios.conf.json` so iOS no longer inherits the desktop bundle identifier.
- Added mobile-safe viewport settings and `100dvh` fallbacks for key shells.

## Local setup

Run these on a Mac with Xcode installed:

```bash
cd /Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui
npm ci
npx tauri ios init
```

If you want to open Xcode instead of immediately running on a simulator/device:

```bash
npx tauri ios dev --open
```

For normal iOS development:

```bash
npx tauri ios dev
```

For a release build:

```bash
npx tauri ios build --export-method app-store-connect
```

## Notes for real-device debugging

- `tauri ios dev` injects `TAURI_DEV_HOST`; the Vite config now listens on `0.0.0.0` automatically when that variable exists.
- If you run on a physical iPhone, make sure the Mac and iPhone are on the same network.
- If your API environment variables point at production, verify the production backend accepts the app’s authentication flow and file URLs from a native shell.

## Work still remaining

The app can now be packaged toward iOS, but it is not yet a polished phone UI. The next implementation pass should focus on:

- Collapse the current two-column workspace into a phone-first navigation model.
- Rework room list, chat composer, file preview, and notebook panels for narrow screens.
- Review file upload/download flows inside iOS WebView.
- Decide whether push notifications will be handled in Tauri native code or deferred.
- Add a dedicated simulator/device QA checklist for login, chat, attachments, and notebook flows.
