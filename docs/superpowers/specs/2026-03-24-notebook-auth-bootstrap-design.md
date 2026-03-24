# Notebook Auth Bootstrap Design

## Summary

This design fixes the recurring mobile/runtime issue where `Notebook` and Notebook-dependent chat entry points briefly enter an invalid auth state immediately after login, often surfacing:

- `Notebook 驗證失敗，請重新登入（token 無效或類型不符）`
- `缺少有效的 Hub/Supabase token。`

The current behavior is incorrect because the first in-app session often has not fully converged yet:

1. Hub session has been written to the auth store.
2. Supabase client may still be bootstrapping or refreshing.
3. `staff/company` still needs `/me` to resolve `notebook_api_base_url`.
4. Notebook capability loading may start while auth is still transitional.

The fix will scope strictly to Notebook-related surfaces:

- Notebook workspace
- Chat Notebook AI / knowledge assist
- Send attachment to Notebook knowledge base

This design does **not** include chat search or AI chat summary.

Rollback anchor for this work is commit `3f2c4f0`.

## Problem Statement

The current implementation conflates two different states:

- transient bootstrap/auth hydration
- hard authentication failure

As a result, Notebook surfaces may show a hard error during a period where the session is still recoverable. In practice, users report that retry does not help and only re-login recovers Notebook content.

This means the current behavior is failing at two levels:

1. The user-facing error policy is wrong.
2. The Notebook auth bootstrap sequence is not being treated as a first-class state.

## Goals

1. After a successful login, Notebook must become usable without requiring a second login.
2. Notebook-related surfaces must not show hard auth failure while auth bootstrap is still in progress.
3. If the Notebook auth state is truly unrecoverable, the UI must guide the user to re-login directly instead of offering a retry that does not help.
4. Changes must stay scoped to `codex/ios-mobile-wip` and avoid unrelated desktop-branch behavior changes.

## Non-Goals

1. Unifying all Hub JWT consumers under a single global auth state machine.
2. Refactoring chat search or AI chat summary in this pass.
3. Changing Notebook business rules, capability semantics, or company/client routing rules.

## Current Failure Mode

### Staff / company flow

Notebook remote auth for `staff` depends on all of the following:

1. valid Hub/Supabase JWT
2. `/me` resolution
3. company-specific `notebook_api_base_url`
4. Notebook capabilities load

Current code may surface `authFailed` or `NO_VALID_HUB_TOKEN` before the above sequence settles.

### Notebook-related chat flow

Chat Notebook AI and “send attachment to knowledge base” build Notebook auth from the same underlying store values, but they do not have a dedicated bootstrap state. They inherit the same transient invalid state and may appear broken even when a recoverable refresh/bootstrap path still exists.

## Proposed Approach

### 1. Introduce explicit Notebook auth outputs

Add two derived outputs in `MainLayout` for Notebook-related functionality:

- `notebookAuthPhase`
  - `bootstrapping`
  - `ready`
  - `hard-auth-failed`
- `notebookErrorPolicy`
  - `none`
  - `retryable-service-error`
  - `relogin-required`

These are not global app auth states. They are limited to Notebook-related functionality.

### 2. Treat transitional auth as recoverable, not fatal

Notebook should remain in `bootstrapping` when any of the following are true:

- Hub session refresh is in progress
- Hub session is present but Notebook JWT is temporarily unresolved and a refresh token exists
- `staff` account is still waiting for `/me`
- `staff` account has not yet resolved company-specific `notebook_api_base_url`
- first capability fetch is still pending

In this phase, the system should not emit the existing hard red auth error.

### 3. Distinguish auth phase from error policy

Notebook-related behavior must use two fields together:

- `notebookAuthPhase`
  - controls whether Notebook-related features are booting, usable, or terminally auth-failed
- `notebookErrorPolicy`
  - controls whether the UI should show nothing, a retry-oriented service error, or direct re-login guidance

### 4. Unify Notebook-related UI behavior

Notebook-dependent surfaces should read from the same derived Notebook auth outputs rather than inventing local heuristics:

- Notebook sidebar / workspace
- Chat Notebook AI trigger
- “Send attachment to knowledge base”

This keeps one root cause from producing different UI behavior across entry points.

## Notebook Auth State Matrix

This pass will use a bounded, explicit classification model instead of open-ended waiting.

### Inputs

The derived Notebook auth outputs will be computed from:

- `hubSession`
- `hubSession.refresh_token`
- `notebookToken.reason`
- `refreshingNotebookToken`
- `hubMeResolved`
- `userType`
- resolved Notebook API base URL
- first capability request completion
- terminal Notebook auth error codes

### Phase rules

#### `bootstrapping`

Enter or remain in `bootstrapping` when all of the following are true:

1. a recoverable path still exists
2. Notebook auth is not yet ready
3. no terminal failure has been confirmed

Concrete cases:

- `notebookToken.reason` is `missing_hub_token`, `expired_hub_token`, or `invalid_hub_token_format`, and a `refresh_token` exists
- `refreshingNotebookToken === true`
- `userType === "staff"` and `hubMeResolved === false`
- `userType === "staff"`, `hubMeResolved === true`, but company Notebook base URL has not been resolved yet
- capability request has been initiated but has not completed yet

#### `ready`

Enter `ready` only when:

1. Notebook token reason is effectively usable
2. required base URL is resolved
3. first capability load has succeeded or returned a non-auth, non-terminal result

Concrete cases:

- Notebook auth object exists
- `staff` has resolved company Notebook base URL
- capability load succeeded
- capability load failed with a recoverable non-auth service issue and the workspace remains auth-ready

#### `hard-auth-failed`

Enter `hard-auth-failed` only when the app has no remaining recovery path for the current session.

Concrete cases:

- `notebookToken.reason` is auth-invalid and there is no `refresh_token`
- a forced refresh attempt returns no usable session
- refresh identity check fails after refresh
- capability or Notebook request returns terminal auth failures after refresh has already been attempted for this session

Terminal auth errors for this pass:

- `NO_VALID_HUB_TOKEN`
- `INVALID_AUTH_TOKEN`
- `INVALID_TOKEN_TYPE`
- HTTP `401`

### Companion error policy

#### `none`

Use `none` when:

- Notebook auth is still bootstrapping
- Notebook auth is ready and there is no active retryable Notebook service failure

#### `retryable-service-error`

Use `retryable-service-error` when:

- `notebookAuthPhase === ready`
- the latest relevant Notebook operation failed for non-auth reasons
- retry remains meaningful

Examples:

- timeout
- transient network failure
- 5xx / system busy
- recoverable capability/list/sync failure

#### `relogin-required`

Use `relogin-required` when:

- `notebookAuthPhase === hard-auth-failed`
- the latest relevant Notebook error is terminal auth failure

This means UI must not offer retry-first behavior for the current session.

### Refresh budget

This pass will not introduce an infinite bootstrap wait.

- The existing request-level refresh path remains the only active recovery path
- the initial Notebook bootstrap may consume one refresh attempt through the current refresh mechanism
- once that recovery path has been attempted and still yields terminal auth failure, phase must become `hard-auth-failed`
- no additional retry button will be offered for terminal auth failures

This keeps the implementation aligned with the current behavior users reported: auth-invalid Notebook states are not fixed by repeated manual retry and should lead directly to re-login.

## UI Behavior

### Notebook workspace

- `bootstrapping`
  - show a neutral state such as “正在同步 Notebook 授权...”
  - do not show `Notebook 驗證失敗`
- `hard-auth-failed`
  - show hard auth error
  - primary action: `重新登入`
  - do not show `重試`
- `ready + retryable-service-error`
  - preserve retry affordance

### Chat Notebook AI / knowledge assist

- `bootstrapping`
  - disable trigger or show unavailable state without red auth banner
- `hard-auth-failed`
  - surface direct re-login guidance
- `ready + retryable-service-error`
  - allow retry

### Send attachment to knowledge base

- `bootstrapping`
  - disable action until Notebook auth becomes ready
- `hard-auth-failed`
  - surface re-login guidance
- `ready + retryable-service-error`
  - preserve retry where meaningful

## Implementation Plan

### MainLayout

Primary changes will live in:

- `/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/layouts/MainLayout.tsx`

Responsibilities:

1. derive `notebookAuthPhase` from:
   - `hubSession`
   - `refreshingNotebookToken`
   - `hubMeResolved`
   - resolved Notebook base URL
   - first capability load status
   - terminal auth error codes
2. derive `notebookErrorPolicy` from the latest classified Notebook failure
3. prevent capability error from entering hard-failure state during bootstrap
4. expose normalized Notebook auth outputs to Notebook-related consumers

### Notebook UI

Primary changes will likely touch:

- `/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/notebook/components/NotebookSidebar.tsx`
- `/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/notebook/components/NotebookPanel.tsx`
- `/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/notebook/useNotebookModule.ts`

Responsibilities:

1. render neutral bootstrap state in the list/sidebar path
2. keep detail-panel error and action surfaces consistent with the same auth outputs
3. suppress retry-oriented Notebook workspace actions for `relogin-required`
4. keep retry for `ready + retryable-service-error`

### Chat Notebook consumers

Primary changes will likely touch:

- `/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/chat/ChatRoom.tsx`

Responsibilities:

1. respect shared Notebook auth outputs
2. disable Notebook AI / knowledge actions during bootstrap
3. map hard auth failure to re-login guidance instead of retry-oriented messaging

## Error Classification Rules

### Bootstrap state

Stay in `bootstrapping` if:

- a refresh path is active or available
- `staff` is still waiting on `/me`
- capability load has not resolved yet
- terminal auth failure has not yet been confirmed after refresh

### Hard auth failure

Enter `hard-auth-failed` only when recovery has already failed or is impossible, such as:

- refresh path exhausted or unavailable
- `NO_VALID_HUB_TOKEN`
- `INVALID_AUTH_TOKEN`
- `INVALID_TOKEN_TYPE`
- auth identity mismatch after refresh

### Recoverable service error

Classify as:

- `notebookAuthPhase = ready`
- `notebookErrorPolicy = retryable-service-error`

for:

- request timeout
- 5xx / system busy
- transient network failure
- non-auth Notebook capability or list failures where retry is still meaningful

## Risks

1. Over-gating Notebook UI could delay visibility longer than necessary.
2. If hard-failure detection is too conservative, users may see indefinite bootstrap instead of a decisive re-login action.
3. Chat Notebook affordances may become temporarily disabled more often during cold start.

## Mitigations

1. Keep the state machine derived and narrow, not a large refactor.
2. Preserve current refresh logic and only change classification/presentation boundaries.
3. Limit the first pass to Notebook-related entry points only.
4. Use commit `3f2c4f0` as the rollback anchor if post-change behavior regresses.

## Verification Plan

### Core

1. Fresh login into app
   - Notebook becomes usable without logging in again
2. First open after login
   - no hard Notebook auth banner during bootstrap
3. True invalid auth scenario
   - show `重新登入`
   - no `重試`
4. Temporary failure scenario
   - retry remains available

### Surfaces

1. Notebook workspace
2. Chat Notebook AI
3. Send attachment to knowledge base

### Regression checks

1. `staff/company` still waits for `/me`
2. `staff/company` still does not fall back to public Notebook host
3. `client` flow still works with public Notebook routing
4. Existing token refresh logic still updates shared store correctly

## Rollback

If the implemented behavior still requires re-login after first successful login, or introduces wider auth regressions, revert the Notebook auth bootstrap work back to:

- `3f2c4f0 feat(android): stabilize mobile login and file center flows`
