# Notebook Mobile Runtime Notes

## Scope

This note records the mobile-specific issues and fixes that were required to get `Notebook` working on iOS for `company/staff` accounts. Keep this file as the baseline reference before starting Android work.

## Core findings

### 1. `company/staff` cannot use the public default Notebook base URL

- `client` traffic may use the public Notebook host:
  - `https://notebook-api.gotradetalk.com`
- `company/staff` must use the company-specific `notebook_api_base_url` returned by `GET /me`.
- For example, `hululucky` staff resolves to:
  - `https://notebook-api.hululucky.com`

If `company/staff` falls back to the public default URL, Notebook sync will fail or return the wrong dataset.

Relevant code:
- [/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/layouts/MainLayout.tsx](/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/layouts/MainLayout.tsx)
- [/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/config.ts](/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/config.ts)

### 2. Mobile Notebook must wait for `/me` before remote sync

`company/staff` Notebook initialization must not start remote sync until:

1. Hub session exists
2. `/me` has completed
3. `notebook_api_base_url` has been resolved

If sync starts before `/me`, the runtime may use the wrong base URL or stale cached state.

Relevant code:
- [/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/layouts/MainLayout.tsx](/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/layouts/MainLayout.tsx)

### 3. The real desktop/mobile difference was the HTTP stack

This was the most important discovery.

Desktop and iOS were not actually using the same effective request path:

- Desktop:
  - `@tauri-apps/plugin-http`
  - fallback to `invoke("desktop_http_request") -> Rust reqwest`
- iOS before fix:
  - mostly `plugin-http / NSURLSession`

The same Notebook request worked on desktop but returned `HTTP 500` on iOS. The practical fix was to force Notebook traffic on iOS to use the same Rust `reqwest` bridge used by desktop fallback.

Current behavior:

- On Tauri mobile, requests to `notebook-api.*` force the invoke bridge instead of relying on `plugin-http`.

Relevant code:
- [/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/desktop/fetchWithDesktopSupport.ts](/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/desktop/fetchWithDesktopSupport.ts)
- [/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src-tauri/src/lib.rs](/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src-tauri/src/lib.rs)

## Notebook-specific mobile fixes

### 1. Mobile sqlite cache enabled

Notebook sqlite cache was originally desktop-only. It is now enabled for all Tauri runtimes, including iOS.

This helps cold start and repeated entry, but it does **not** fix wrong base URLs or broken auth by itself.

Relevant code:
- [/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/notebook/sqliteCache.ts](/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/notebook/sqliteCache.ts)

### 2. Notebook sync timeout increased

Snapshot sync timeout was extended:

- from `20s`
- to `60s`

This reduces false failures for larger `company` knowledge bases.

Relevant code:
- [/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/notebook/useNotebookModule.ts](/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/notebook/useNotebookModule.ts)

### 3. `company/staff` should not silently fall back to local-only Notebook

For company knowledge bases, local fallback is misleading. If remote sync is required and unavailable, the UI should surface the real error instead of pretending local mode is enough.

Relevant code:
- [/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/notebook/useNotebookModule.ts](/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/notebook/useNotebookModule.ts)

## Runtime debug added for Notebook

When Notebook fails, the UI now exposes runtime debug fields so the actual failure mode is visible without guessing.

Fields currently exposed include:

- `userType`
- `hubMeResolved`
- `configuredNotebookApiBaseUrl`
- `notebookApiBaseUrlOverride`
- `effectiveNotebookApiBaseUrl`
- `hasHubAccessToken`
- `hasMatrixAccessToken`
- `matrixUserId`
- `notebookTokenReason`
- `hasNotebookAuth`
- `hasNotebookWorkspaceAuth`
- `capabilityLoaded`
- `capabilityError`
- `capabilityValues`
- `listState`
- `listError`
- `actionError`
- last request `method/path/url/query/request/response/error`

Relevant code:
- [/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/services/notebookApi.ts](/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/services/notebookApi.ts)
- [/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/notebook/useNotebookModule.ts](/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/notebook/useNotebookModule.ts)
- [/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/notebook/components/NotebookSidebar.tsx](/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/notebook/components/NotebookSidebar.tsx)
- [/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/notebook/components/NotebookPanel.tsx](/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/features/notebook/components/NotebookPanel.tsx)

## What to check first on Android

Before debugging Notebook UI on Android, verify these in order:

1. `userType === "staff"` or `client`
2. `/me` finished and returned the expected `notebook_api_base_url`
3. `effectiveNotebookApiBaseUrl` matches the company-specific Notebook host
4. Hub JWT exists and `notebookTokenReason === "ok"`
5. Notebook requests are using the intended native HTTP path
6. `GET /notebook/items` returns the same result as desktop for the same account

If Android reproduces “desktop works, mobile fails”, inspect the HTTP stack first before changing Notebook business logic.

## Recommended Android checklist

- Reuse the same Notebook init ordering as iOS:
  - wait for `/me`
  - do not fall back to the public Notebook host for `staff/company`
- Reuse Tauri sqlite Notebook cache
- Verify whether Android should also force `notebook-api.*` through the Rust `reqwest` bridge
- Keep Notebook runtime debug visible during Android bring-up

## Notebook auth bootstrap contract

Mobile and shared runtime behavior now distinguishes Notebook auth bootstrap from true auth failure.

### 1. Notebook-related surfaces share one auth contract

The following surfaces should consume the same Notebook auth outputs:

- Notebook workspace
- chat Notebook AI / knowledge assist
- send attachment to knowledge base

They should not invent separate auth heuristics.

### 2. Bootstrap is not a hard auth failure

When any recoverable path still exists, Notebook should remain in a bootstrap state instead of immediately surfacing:

- `Notebook 驗證失敗，請重新登入（token 無效或類型不符）`

Typical bootstrap cases:

- Hub refresh is in progress
- Hub refresh token exists and Notebook token is still being restored
- `staff/company` is still waiting for `/me`
- `staff/company` has not yet resolved company-specific `notebook_api_base_url`
- first capability load is still pending

Expected UI behavior:

- Notebook workspace shows a neutral syncing/waiting state
- chat Notebook entry points stay disabled or waiting
- no hard auth banner yet

### 3. Terminal auth failures should prefer re-login, not retry

If Notebook auth is truly unrecoverable for the current session, the UI should guide the user to re-login directly.

Terminal auth failures include:

- `NO_VALID_HUB_TOKEN`
- `INVALID_AUTH_TOKEN`
- `INVALID_TOKEN_TYPE`
- `HTTP 401`
- auth identity mismatch after refresh

Expected UI behavior:

- show re-login guidance
- do not show retry-first behavior for these auth failures

This change was required because retrying these errors did not restore Notebook access in practice; only re-login did.

### 4. Retry is reserved for service failures

`Retry` should remain available only for recoverable Notebook service problems such as:

- timeout
- transient network failure
- 5xx / system busy
- recoverable capability/list/sync failures

This means Notebook UI now separates:

- auth bootstrap
- terminal auth failure
- retryable service failure

instead of treating all three as the same user-facing error.

## Non-Notebook issue that appeared during iOS bring-up

This is separate from Notebook, but worth remembering because it can mask Notebook testing:

- iOS notification sound initialization triggered:
  - `Failed to start the audio device`
- The fix was to disable notification sound initialization on iOS Tauri mobile.

Relevant code:
- [/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/utils/notificationSound.ts](/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/utils/notificationSound.ts)
- [/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/layouts/MainLayout.tsx](/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/src/layouts/MainLayout.tsx)
