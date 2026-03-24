# Notebook Terminal Auth Logout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Force an immediate return to the login page whenever a `Notebook` surface reaches a confirmed terminal auth failure, while preserving existing retry behavior for non-terminal service errors.

**Architecture:** Introduce one shared terminal-auth classification helper, then wire a single guarded logout handler through `MainLayout` and the chat-side `Notebook` entry points. Keep the change narrow: do not touch search flows, do not rework bootstrap, and do not add new global auth abstractions.

**Tech Stack:** React 19, TypeScript, React Router, Zustand auth store, Node test runner, Vite build

---

## File Map

- Create: `tests/notebook-terminal-auth-logout.test.ts`
- Create: `src/features/notebook/utils/isNotebookTerminalAuthFailure.ts`
- Modify: `src/layouts/MainLayout.tsx`
- Modify: `src/features/notebook/components/NotebookSidebar.tsx`
- Modify: `src/features/notebook/components/NotebookPanel.tsx`
- Modify: `src/features/chat/ChatRoom.tsx`
- Modify: `src/features/notebook/notebookErrorMap.ts`

`MainLayout.tsx` remains the canonical place for session clearing and route transitions. The new helper file keeps terminal-auth classification out of the UI files so the same rule can be reused by the `Notebook` page and chat-side `Notebook` actions without re-encoding string/error checks.

### Task 1: Extract shared terminal-auth classification

**Files:**
- Create: `tests/notebook-terminal-auth-logout.test.ts`
- Create: `src/features/notebook/utils/isNotebookTerminalAuthFailure.ts`
- Modify: `src/features/notebook/notebookErrorMap.ts`

- [ ] **Step 1: Write the failing tests**

Add `tests/notebook-terminal-auth-logout.test.ts` with focused cases for:

- `NO_VALID_HUB_TOKEN` => terminal auth failure
- `INVALID_AUTH_TOKEN` => terminal auth failure
- `INVALID_TOKEN_TYPE` => terminal auth failure
- `HTTP 401` only when the existing refresh path has already failed and the state is explicitly terminal => terminal auth failure
- timeout / `5xx` / generic request errors => not terminal auth failure

Add one explicit negative case:

- a recoverable or pre-refresh `401` must **not** be classified as terminal auth failure

The test should cover both raw notebook API errors and the `MainLayout`-side string/code inputs that currently produce `layout.notebook.authFailed`.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test --experimental-strip-types tests/notebook-terminal-auth-logout.test.ts
```

Expected: FAIL because the shared classifier does not exist yet.

- [ ] **Step 3: Implement the minimal shared helper**

Create `src/features/notebook/utils/isNotebookTerminalAuthFailure.ts` that exports small, explicit predicates for:

- notebook API error objects / codes
- `MainLayout` capability/auth error state inputs

Keep the helper narrow. It should only answer whether the failure is terminal-auth-related; it should not perform logout, routing, or retry decisions.

Update `src/features/notebook/notebookErrorMap.ts` to reuse the same classifier or code grouping so chat-side `Notebook` error handling and page-side handling stay aligned.

The helper must classify from the canonical post-refresh-failure signal already available in the codepath. It must not infer “terminal” from any raw `401` by itself.

- [ ] **Step 4: Re-run the test and make it pass**

Run:

```bash
node --test --experimental-strip-types tests/notebook-terminal-auth-logout.test.ts
```

Expected: PASS with the terminal-auth/non-terminal cases clearly separated.

- [ ] **Step 5: Commit the helper**

```bash
git add tests/notebook-terminal-auth-logout.test.ts src/features/notebook/utils/isNotebookTerminalAuthFailure.ts src/features/notebook/notebookErrorMap.ts
git commit -m "test: classify terminal notebook auth failures"
```

### Task 2: Auto-logout from Notebook page state

**Files:**
- Modify: `src/layouts/MainLayout.tsx`
- Modify: `src/features/notebook/components/NotebookSidebar.tsx`
- Modify: `src/features/notebook/components/NotebookPanel.tsx`

- [ ] **Step 1: Add a shared, guarded logout action in `MainLayout`**

In `src/layouts/MainLayout.tsx`, add one narrow handler, conceptually:

- checks a ref/flag so it only runs once per failure burst
- clears session state via the existing store action
- navigates to the login route using the existing logout/navigation path

Do not add a new global auth subsystem. Reuse the current `clearSession()` and route behavior.

- [ ] **Step 2: Detect terminal Notebook auth failure in `MainLayout`**

Replace the current behavior that leaves `capabilityError` rendered in-place for terminal auth failures.

Wire the new shared classifier to the existing `Notebook` capability/auth state so that:

- terminal auth failure triggers the guarded logout handler
- timeout / `5xx` / system-busy cases still stay in place

Keep detection localized to the `Notebook` path. Do not touch search error handling.

- [ ] **Step 3: Remove page-level re-login affordances**

Update `src/features/notebook/components/NotebookSidebar.tsx` and `src/features/notebook/components/NotebookPanel.tsx` so they no longer rely on page-level retry/re-login UI for terminal auth failure.

Expected end state:

- terminal auth failure does not leave the user parked on the red Notebook auth card
- non-terminal notebook errors can still render in place when retry remains meaningful

- [ ] **Step 4: Run the build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit the page-level logout behavior**

```bash
git add src/layouts/MainLayout.tsx src/features/notebook/components/NotebookSidebar.tsx src/features/notebook/components/NotebookPanel.tsx
git commit -m "feat: auto-logout on terminal notebook auth failure"
```

### Task 3: Align chat-side Notebook entry points

**Files:**
- Modify: `src/features/chat/ChatRoom.tsx`
- Modify: `src/layouts/MainLayout.tsx`

- [ ] **Step 1: Pass the shared logout handler into chat Notebook surfaces**

Expose the existing `Notebook` terminal-auth logout action through the same outlet/chat context that already carries:

- `notebookCapabilityError`
- `onRetryNotebookCapability`
- `onReloginForNotebook`

Prefer reusing or replacing `onReloginForNotebook` rather than inventing a second parallel callback.

- [ ] **Step 2: Convert chat Notebook terminal auth failures into immediate logout**

In `src/features/chat/ChatRoom.tsx`, update the `Notebook AI` and “send to Notebook” flows so that terminal notebook auth failures call the shared logout action instead of leaving the user on a local error message that says re-login.

Do not apply this behavior to:

- room search
- chat search
- non-Notebook auth failures

- [ ] **Step 3: Keep retryable errors local**

Verify the chat-side notebook code still keeps:

- timeout
- `5xx`
- generic request failure

as in-place errors instead of forced logout.

- [ ] **Step 4: Re-run targeted test and full build**

Run:

```bash
node --test --experimental-strip-types tests/notebook-terminal-auth-logout.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit the chat alignment**

```bash
git add src/features/chat/ChatRoom.tsx src/layouts/MainLayout.tsx
git commit -m "feat: align chat notebook auth logout behavior"
```

### Task 4: Release-focused verification

**Files:**
- Modify: none unless a regression fix is required

- [ ] **Step 1: Verify the narrow behavior contract**

Manual verification checklist:

- trigger a confirmed terminal `Notebook` auth failure
- confirm the app immediately returns to login
- confirm the user does not stay on the red Notebook auth card
- confirm duplicate failure signals do not create redirect loops
- confirm timeout / `5xx` do not force logout
- confirm the work is implemented and verified on `codex/ios-mobile-wip` before any pick/port to the app/desktop release line

- [ ] **Step 2: Record any environment blockers**

If Android/iOS/app validation cannot be completed in-session, record the exact blocker and avoid speculative claims.

- [ ] **Step 3: Final commit if any verification-driven fix was required**

```bash
git status
```

Expected: clean working tree, or one small follow-up commit if verification exposed a narrow bug.
