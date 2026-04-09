# Translation Test Plan v1

## 目標
- 規則準確性（誰會翻譯／誰不會翻譯）
- 相同語言跳過（不呼叫 LLM）
- 長文／短文情境（延遲／等待／快取）
- 快取命中（避免重複呼叫）
- 失敗／封鎖時的 UX（原文優先、狀態顯示）

## 測試帳號
- client C1: tonywei49
- client C2: xiaochen13513
- staff S1: test.sean
- staff S2: test.john（同公司）

## 環境
- Hub API: https://api.gotradetalk.com
- Client HS: https://matrix.gotradetalk.com
- Staff HS: https://matrix.hululucky.com
- 預設目標語言: ja
- Room（staff-client）: !O9ISyZY9rZUxgU4DDz:matrix.hululucky.com
- Room（staff-staff same）: !LnpC8f7svOXBbgwDWM:matrix.hululucky.com
- Room（client-client）: 實際 C1-C2 DM room

## 文字樣本
- T_SHORT_EN: "hello from test"
- T_SHORT_ZH: "你好，测试翻译"
- T_SHORT_JA: "これは日本語です"
- T_LONG_EN: 800+ chars，包含編號／換行
- T_LONG_ZH: 400+ chars，包含編號／換行

## 規則驗證
1. C1 <- S1 (target=ja, short)
   - 預期: 200，有翻譯
2. S1 <- C1 (target=ja, short)
   - 預期: 200，有翻譯
3. S1 <- S2 (same company)
   - 預期: 403 TRANSLATION_NOT_ALLOWED
4. C1 <- C2
   - 預期: 403 TRANSLATION_NOT_ALLOWED

## 相同語言跳過
1. S1 <- C1, T_SHORT_JA, target=ja
   - 預期: latency_ms=0，翻譯=原文
2. C1 <- S1, T_SHORT_EN, target=en
   - 預期: latency_ms=0
3. 以新 message_id 重複
   - 預期: 不呼叫 LLM
4. 接收語言 = 訊息語言
   - 預期: 跳過翻譯（保留原文）

## 長文／短文情境
1. short (new message_id)
   - 預期: 正常翻譯
2. long (new message_id)
   - 預期: 先顯示原文，之後顯示翻譯
3. 相同 key 重新呼叫
   - 預期: latency_ms=0（cache hit）

## UI 驗證
- 有翻譯: 預設顯示翻譯，提供原文按鈕
- 無翻譯: 預設顯示原文
- 點擊翻譯按鈕:
  - pending: "Translating..."
  - failed: "Translation unavailable"

## 失敗／封鎖
- NOT_SUBSCRIBED / CLIENT_TRANSLATION_DISABLED / QUOTA_EXCEEDED
- 預期: 顯示原文，顯示翻譯狀態

## 自動回歸
- hub-backend: npm run test:translation-regression

## 執行紀錄 (2026-02-08)
- same-lang skip (ja -> ja): latency_ms=0，翻譯=原文
- long text first: latency_ms=13359, end-to-end=15419ms
- long text cache: latency_ms=0, end-to-end=1528ms
