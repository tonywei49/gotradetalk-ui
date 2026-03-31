# Desktop MainLayout Light-Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Windows startup OOM by turning the workspace into a lightweight shell that defers Matrix startup and heavy module initialization until after the shell is visible.

**Architecture:** Keep the desktop bootstrap and splash behavior stable, but make `/app` mount a lightweight workspace shell first. Move Matrix startup, room list mounting, notebook/task hooks, and other heavy modules behind staged rendering and dynamic imports so the first visible frame is cheap.

**Tech Stack:** React, React Router, Zustand, Tauri 2, Vite code splitting, matrix-js-sdk.

---

### Task 1: Split MainLayout into a light shell and lazy heavy panels

**Files:**
- Create: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src/layouts/MainLayoutShell.tsx`
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src/layouts/MainLayout.tsx`
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src/App.tsx`

- [ ] Extract the lightweight chrome, navigation, and workspace placeholders into `MainLayoutShell.tsx`.
- [ ] Keep `MainLayout.tsx` focused on heavy chat/workspace content instead of the initial visible shell.
- [ ] Make `/app` show the shell immediately, then mount heavy content after the shell reports ready.

### Task 2: Delay Matrix client startup until after shell visibility

**Files:**
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src/stores/AuthStore.ts`
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src/layouts/MainLayout.tsx`
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src/App.tsx`

- [ ] Remove any startup path that eagerly creates or starts Matrix during shell mount.
- [ ] Gate `ensureMatrixClient()` and `startClient()` behind a post-shell-visible stage.
- [ ] Ensure startup failure leaves the shell alive with an actionable loading/error state instead of crashing the renderer.

### Task 3: Move notebook and task modules behind tab-gated lazy boundaries

**Files:**
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src/layouts/MainLayout.tsx`
- Create if needed: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src/features/notebook/NotebookWorkspaceLazy.tsx`
- Create if needed: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src/features/tasks/TaskWorkspaceLazy.tsx`

- [ ] Stop calling `useNotebookModule()` during chat startup.
- [ ] Stop calling `useTaskModule()` during chat startup.
- [ ] Lazy-load notebook/task UI and hooks only when their tab is active or explicitly prepared.

### Task 4: Make RoomList and ChatRoom mount in stages

**Files:**
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src/layouts/MainLayout.tsx`
- Modify if needed: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src/features/rooms/RoomList.tsx`

- [ ] Keep the shell visible while room list and chat area mount separately.
- [ ] Avoid blocking shell visibility on room list hydration.
- [ ] Preserve the existing room/chat UX once the staged mount completes.

### Task 5: Validation and release

**Files:**
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/package.json`
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src-tauri/tauri.conf.json`
- Modify: `/Users/mac/Documents/github/.desktop-release-prep-worktree/src-tauri/Cargo.toml`

- [ ] Run `npm run build`.
- [ ] Run `cargo check` inside `/Users/mac/Documents/github/.desktop-release-prep-worktree/src-tauri`.
- [ ] Commit desktop release line changes.
- [ ] Push `codex/desktop-release-prep`.
- [ ] Tag and push the next desktop test version.
