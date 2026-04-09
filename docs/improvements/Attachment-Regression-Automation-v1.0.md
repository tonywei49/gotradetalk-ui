# Attachment 回歸自動化執行說明 v1.0

## 腳本位置

- `gotradetalk-ui/scripts/regression-matrix.mjs`
- npm 指令：`npm run test:regression:matrix`

## 覆蓋範圍（目前）

1. 群聊複雜邀請路徑（API 層）
- A 邀請 B，B 加入後退出
- A 再邀 B + C，B/C 加入，C 退出
- C 再次受邀並再次加入（固定執行）
- D 分支（若提供獨立 D 帳號才執行）
- 房主 A 移除 B（kick）驗證
- 每次受邀後檢查 invite state 的 `m.room.create.room_version`

2. 附件 API 基礎流（API 層）
- 上傳附件
- 發送附件訊息
- Redact 附件訊息

3. 報告輸出
- 產出：`gotradetalk-ui/regression-reports/Attachment-Regression-Run-latest.md`

## 執行方式

```bash
cd /Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui

MATRIX_BASE_URL='https://matrix.hululucky.com' \
MATRIX_USER_A='test.john' MATRIX_PASS_A='******' \
MATRIX_USER_B='test.sean' MATRIX_PASS_B='******' \
MATRIX_USER_C='test.jack' MATRIX_PASS_C='******' \
MATRIX_USER_D='test.david' MATRIX_PASS_D='******' \
npm run test:regression:matrix
```

若沒有 D 帳號，可不帶 `MATRIX_USER_D/MATRIX_PASS_D`，腳本會跳過 D 分支並記錄為 `WARN`。

## 結果判讀

- `PASS`：該測試點通過。
- `FAIL`：該測試點失敗，需排查。
- `WARN`：環境限制或分支跳過，不視為流程失敗。

### 已知 WARN（截至 2026-02-13）

- 若未提供獨立 D 帳號，`login-D` / D 分支會記錄為 `WARN`（屬預期）。
- `file-media-delete` 已在 `https://matrix.hululucky.com` 驗證通過：
  - `/_matrix/client/v3/media/delete/{serverName}/{mediaId}` 回傳成功（PASS）。

## 尚未自動化部分（需人工/E2E）

1. UI 互動驗證
- 加入按鈕點擊後是否即時進房
- 檔案中心版面與手機排版
- 預覽視窗拖曳/縮放體驗

2. 多端同步體驗
- UI 與 Element 的即時一致性
- 刷新後畫面狀態一致

建議：API 自動化每次部署前先跑，UI 變更再補人工 smoke test。

## 最新驗證記錄（2026-02-13）

- 測試環境：`https://matrix.hululucky.com`
- 測試帳號：`test.john / test.sean / test.jack`
- 結果摘要：
  - 群聊邀請、重邀、kick：PASS
  - 附件上傳、發送、redact：PASS
  - media delete endpoint：PASS
