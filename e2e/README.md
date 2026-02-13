# Playwright E2E (Smoke)

## Required env

- `PLAYWRIGHT_BASE_URL` (example: your hosted UI URL)
- `E2E_CLIENT_USERNAME`
- `E2E_CLIENT_PASSWORD`

## Run

```bash
npm run test:e2e
```

## Current smoke coverage

- client login
- upload attachment -> send -> delete (redact) message

## Files-center regression (large dataset)

Script path:
- `scripts/files-center-regression.mjs`

What it does:
- seeds a new private room with many file-message events (default `90`)
- opens Files Center and verifies room search/list search
- checks `Load more` visibility when list exceeds first page
- enables batch mode and checks delete-progress feedback

Run:

```bash
PLAYWRIGHT_BASE_URL=https://chat.gotradetalk.com \
E2E_STAFF_COMPANY_SLUG=hululucky \
E2E_STAFF_TLD=com \
E2E_STAFF_USERNAME=test.john \
E2E_STAFF_PASSWORD=your_password \
E2E_FILES_SEED_COUNT=90 \
node scripts/files-center-regression.mjs
```

Expected output markers:
- `seed_room_id=...`
- `seed_room_name=...`
- `seed_count=...`
- `login_ok=true`
- `room_search_ok=true`
- `room_select_ok=true`
- `load_more_visible=true`
- `batch_mode_enabled=true`
- `batch_items_checked=<n>`
- `batch_progress_visible=true`


### Staff mode

```bash
E2E_LOGIN_MODE=staff \
E2E_STAFF_COMPANY_SLUG=hululucky \
E2E_STAFF_TLD=com \
E2E_STAFF_USERNAME=test.john \
E2E_STAFF_PASSWORD=your_password \
PLAYWRIGHT_BASE_URL=https://chat.gotradetalk.com \
npm run test:e2e
```
