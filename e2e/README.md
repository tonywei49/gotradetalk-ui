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
