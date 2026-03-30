# Desktop Startup Bootstrap Design

**Goal**: Stop Windows release builds from reaching an out-of-memory state before the splash/loading experience can complete by splitting startup into a lightweight bootstrap phase and a deferred heavy initialization phase.

## Problem
The desktop app creates the hidden `main` window at process start, and that window immediately loads the full React bundle. On authenticated launches, store initialization recreates the Matrix client before the UI is visible. The splash screen stays up until `hubMeResolved`, while the hidden main window performs heavy startup work. On Windows WebView2 this can exhaust renderer memory before the main window is shown, leaving a blank splash-sized window and later an out-of-memory error page when the hidden main window is revealed.

## Design
1. The visible startup contract changes from "show main when workspace initialization is done" to "show main as soon as the lightweight shell is mounted".
2. The React entry must remain lightweight before that signal fires. In practice, authenticated startup should not eagerly recreate the Matrix client inside store construction.
3. Heavy startup work moves behind a dedicated bootstrap effect that runs after the main window is visible. That includes recreating the Matrix client from persisted credentials and starting Matrix sync.
4. The Rust-side 20-second forced reveal is removed. If boot never reaches ready, that is a startup bug and should remain visible as a splash stall rather than force-showing a broken main window.

## File responsibilities
- `src/stores/AuthStore.ts`: restore persisted credentials/session without instantiating Matrix client during store creation; expose a method to hydrate/create the Matrix client explicitly.
- `src/App.tsx`: signal desktop boot readiness immediately after the root shell mounts for authenticated desktop sessions, then lazy-load the heavy workspace routes.
- `src/layouts/MainLayout.tsx`: only start Matrix once an already-created client exists; stop owning the first `desktop_boot_ready` signal.
- `src/desktop/useDesktopWindowLifecycle.ts`: continue handling keyboard shortcuts and close-to-hide behavior, but treat boot-ready as a lightweight shell concern.
- `src-tauri/src/lib.rs`: remove the unconditional 20-second reveal fallback.

## Validation
- Desktop release build must compile.
- Startup should still show the splash screen, then the main window loading state, without a blank stuck window.
- Existing authenticated sessions should still reach `/app` and then initialize Matrix in the background.
