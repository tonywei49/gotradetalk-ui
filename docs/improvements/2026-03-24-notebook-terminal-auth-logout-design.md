# Notebook Terminal Auth Logout Design

## Summary

This design changes the user-facing behavior for `Notebook` terminal authentication failures.

Today, some `Notebook`-dependent entry points may surface a hard auth error such as:

- `Notebook 驗證失敗，請重新登入（token 無效或類型不符）`
- `缺少有效的 Hub/Supabase token。`

The current UI then offers local retry/re-login controls inside the page. That behavior is not useful for the reported failure mode. The user has already confirmed that, in practice, once this specific `Notebook` auth state is reached, retry does not help and the only effective recovery is a full re-login.

This design therefore changes the policy for **terminal `Notebook` auth failures**:

- do not keep the user inside the broken page state
- do not ask the user to decide between retry and re-login
- immediately clear session state and return to the login page

This pass is intentionally narrow and is meant to be safe for both mobile and app/desktop release workflows.

## Problem Statement

`Notebook` auth failures currently leave the app in a partially broken state:

1. `Notebook`-dependent UI becomes unusable.
2. The page may show retry/re-login controls.
3. Retry is not meaningful for the terminal auth cases the user reported.
4. The user still has to manually perform the recovery step that the system already knows is required.

That is the wrong interaction model for terminal auth failure. Once the app has enough information to conclude that the current `Notebook` session is unrecoverable, the app should stop pretending local recovery is still possible.

## Goals

1. When `Notebook` reaches a terminal auth failure, the app must immediately return the user to the login page.
2. The behavior must be shared across mobile and app/desktop codepaths that use the same `Notebook` auth surfaces.
3. The change must remain narrowly scoped so it is safe to release and easy to roll back.
4. Normal retryable failures must continue to stay in place and must not trigger forced logout.

## Non-Goals

1. Reworking the entire `Notebook` bootstrap model.
2. Changing chat search, room search, or AI chat summary behavior.
3. Auto-refreshing or silently repairing `Notebook` auth beyond what already exists.
4. Refactoring unrelated authentication flows.

## Scope

This pass applies only to `Notebook`-dependent surfaces:

- `Notebook` page / workspace
- chat `Notebook AI` entry points
- chat actions that send content to the `Notebook` knowledge base

This pass does not change:

- room search
- chat search
- non-Notebook Hub auth errors

## Trigger Conditions

The app should force logout only for explicit terminal `Notebook` auth failures.

### Terminal auth failures in scope

- `NO_VALID_HUB_TOKEN`
- `INVALID_AUTH_TOKEN`
- `INVALID_TOKEN_TYPE`
- `HTTP 401` from a `Notebook` request after the existing refresh path has already failed to recover the session

### Failures that must NOT force logout

- request timeout
- transient network failure
- `5xx`
- system busy / rate limiting
- recoverable service failures where retry remains meaningful

## Proposed Behavior

### 1. Replace local re-login UI with automatic recovery routing

When a `Notebook` surface detects a terminal auth failure, the app should:

1. clear the current app session
2. navigate back to the login page

The app should not keep the user inside the broken `Notebook` UI state.

### 2. Use one shared terminal-auth handler

Instead of having each `Notebook` surface decide its own action, the app should use one shared action, conceptually:

- `handleNotebookTerminalAuthFailure()`

That action is responsible for:

- preventing duplicate execution
- clearing session state
- routing to login

This avoids mismatched behavior between the `Notebook` page and chat-side `Notebook` actions.

### 3. Preserve retry behavior for non-terminal failures

If a `Notebook` operation fails for non-auth reasons, the app should stay on the current page and keep existing retry-oriented behavior.

The forced logout behavior is only for explicit terminal auth failure.

### 4. Keep the transition single-shot

Once a terminal `Notebook` auth failure is detected, the app should trigger logout once and stop.

The app should not:

- repeatedly redirect
- flash multiple error banners before redirect
- attempt repeated local retries before redirecting

## State Handling Rules

For this pass, the `Notebook` auth handling should be simplified into two practical buckets:

### Retryable / stay in place

Stay on the current screen when:

- retry may succeed
- the session is still considered valid
- the error is service-related rather than terminal-auth-related

### Terminal auth / force logout

Force logout when:

- the current `Notebook` auth is known to be unusable
- the current session cannot continue `Notebook` actions safely
- the only valid next step is a fresh login

## UX Notes

The redirect should be direct and minimal.

Acceptable behavior:

- immediate redirect to login
- optional single toast such as `Notebook 驗證失敗，請重新登入`

Unwanted behavior:

- staying on the broken page with buttons
- requiring the user to press `重新登入`
- showing retry controls for terminal auth failures

## Rollout Strategy

Because this is shared frontend behavior, it should be implemented first on `codex/ios-mobile-wip`.

Recommended release flow:

1. implement and verify on `codex/ios-mobile-wip`
2. validate on mobile first
3. only after validation, decide whether to pick the same change into the app/desktop release line

This keeps the desktop release line insulated until the behavior is proven.

## Testing

Minimum verification:

1. Trigger a terminal `Notebook` auth failure.
2. Confirm the app clears session state and returns to login immediately.
3. Confirm the `Notebook` page no longer sits on the red error card with retry/re-login buttons.
4. Confirm chat-side `Notebook AI` and send-to-Notebook actions behave the same way.
5. Confirm timeout / network / `5xx` failures do not force logout.

## Rollback

If this change causes unexpected logout loops or misclassifies retryable errors as terminal auth failures, it should be reverted as one isolated behavior change.

The implementation should therefore stay narrowly scoped and avoid coupling to unrelated auth refactors.
