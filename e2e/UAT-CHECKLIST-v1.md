# UAT Checklist v1

## Scope
This checklist covers final acceptance for:
- invite/remove regression
- attachment flow
- files center large-data behavior
- toast/error consistency
- deployment health

## Environment
- URL: `https://chat.gotradetalk.com`
- Login mode: `staff`
- Test user: `test.john`
- Matrix homeserver: `https://matrix.hululucky.com`

## A. Auth and Toast
- [ ] Staff login success
- [ ] Invalid password shows unified toast (no raw MatrixError dump)
- [ ] Auth failure keeps page interactive (no frozen submit)

## B. Invite / Remove Regression
- [ ] Group invite accepted without refresh
- [ ] Removed member exits room view immediately
- [ ] Member join/leave/kick notice appears in timeline
- [ ] Removed member receives popup notice

## C. Attachment Flow
- [ ] Select file uploads immediately
- [ ] Message sends only after clicking send
- [ ] Cancel (X) removes pending attachment
- [ ] File message has `...` actions
- [ ] Delete file emits system notice `xxx撤回一個文件`

## D. Upload Interruption Recovery
- [ ] Offline upload shows retry-queued/failed-visible state
- [ ] Refresh does not silently drop pending row
- [ ] Failed item supports manual reselect
- [ ] Reselect leads to ready-to-send state

## E. Files Center (Large Data)
- [ ] Room search works under large dataset
- [ ] File list search works under large dataset
- [ ] `Load more` appears when total files > first page
- [ ] Batch delete shows progress (`done/total`)
- [ ] Batch delete disables duplicate actions while running

## F. Deployment and Runtime
- [ ] `/healthz` returns `200 ok`
- [ ] Browser hard refresh loads app route correctly
- [ ] Deep-link route works (e.g. `/auth`)
- [ ] No blocking console errors in normal login/chat flow

## Automation commands
```bash
# smoke
PLAYWRIGHT_BASE_URL=https://chat.gotradetalk.com \
E2E_LOGIN_MODE=staff \
E2E_STAFF_COMPANY_SLUG=hululucky \
E2E_STAFF_TLD=com \
E2E_STAFF_USERNAME=test.john \
E2E_STAFF_PASSWORD='***' \
npx playwright test e2e/tests/smoke-auth.spec.mjs e2e/tests/smoke-attachment.spec.mjs

# large-data files center
PLAYWRIGHT_BASE_URL=https://chat.gotradetalk.com \
E2E_STAFF_COMPANY_SLUG=hululucky \
E2E_STAFF_TLD=com \
E2E_STAFF_USERNAME=test.john \
E2E_STAFF_PASSWORD='***' \
node scripts/files-center-regression.mjs
```
