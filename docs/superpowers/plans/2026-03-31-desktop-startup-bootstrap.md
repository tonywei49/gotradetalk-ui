# Desktop Startup Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop startup show a lightweight shell immediately and defer heavy authenticated initialization until after the main window is visible.

**Architecture:** Split startup into two phases. Phase 1 mounts a lightweight app shell and signals `desktop_boot_ready` immediately for authenticated desktop launches. Phase 2 restores the Matrix client and starts sync from React effects after the shell is already visible. Rust no longer force-reveals a broken hidden main window after 20 seconds.

**Tech Stack:** React, Zustand, matrix-js-sdk, Tauri 2, Rust.

---

### Task 1: Defer Matrix client creation out of store construction

**Files:**
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src/stores/AuthStore.ts`

- [ ] Add an explicit store method that creates/restores the Matrix client from the currently persisted credentials.
- [ ] Remove eager `createMatrixClient(...)` calls from the initial persisted-state load path.
- [ ] Keep `setSession(...)` behavior correct for fresh logins.
- [ ] Verify no compile errors in consumers.

### Task 2: Make desktop boot-ready fire from the lightweight shell

**Files:**
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src/App.tsx`
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src/desktop/useDesktopWindowLifecycle.ts`

- [ ] Add a lightweight authenticated bootstrap path that can signal `desktop_boot_ready` before workspace initialization finishes.
- [ ] Ensure Windows desktop still exposes F12 / Ctrl+Shift+I.
- [ ] Preserve existing unauthenticated behavior.

### Task 3: Defer Matrix startup until after the shell is visible

**Files:**
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src/layouts/MainLayout.tsx`

- [ ] Stop using `hubMeResolved` as the first `desktop_boot_ready` gate.
- [ ] Only run `prepareMatrixClient/startClient` after a client exists in store.
- [ ] Preserve existing capability and notebook flows once startup finishes.

### Task 4: Remove Rust forced reveal fallback

**Files:**
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src-tauri/src/lib.rs`

- [ ] Remove the 20-second forced `reveal_primary_instance` timer from setup.
- [ ] Keep tray/single-instance reveal behavior intact.

### Task 5: Validate desktop startup

**Files:**
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/package.json` (only if release tagging later requires version bump)

- [ ] Run `npm run build` in `/Users/mac/Documents/github/.desktop-release-prep-worktree`.
- [ ] Run `cargo check` in `/Users/mac/Documents/github/.desktop-release-prep-worktree/src-tauri`.
- [ ] Review startup code paths for authenticated desktop sessions.
