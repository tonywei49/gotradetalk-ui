# GoTradeTalk v2.0 客戶端開發計劃 (Development Plan)

> **目標**：基於 `matrix-js-sdk` 從零構建 React 客戶端 (`gotradetalk-ui`)。
> **週期**：分為 4 個階段 (Phases)，按順序執行以降低風險。

---

## Phase 1: 基礎架構與認證 (Infrastructure & Auth)
**目標**：跑通「雙入口」登入流程，確保能成功連接 Matrix HS 並獲取 Access Token。

1.  **工程初始化**
    *   [x] 初始化 Vite + React + TypeScript 專案。
    *   [x] 配置 Tailwind CSS / CSS Modules。
    *   [x] 安裝核心依賴 (`matrix-js-sdk`, `@supabase/supabase-js`, `zustand`, `react-router-dom`)。
    *   [x] 配置環境變量 (`.env`)。
    *   [x] 建立 i18n 基礎（英文 / 简体中文）。

2.  **SDK 封裝**
    *   [x] 封裝 `MatrixClient` 初始化邏輯（**重點：確保關閉 Crypto**）。
    *   [x] 建立 `AuthStore` (Zustand) 管理登入狀態與 User Profile。

3.  **雙入口登入 UI**
    *   [x] 實現 `AuthPage` (Tab 切換：客戶/員工)。
    *   [x] **員工登入**：對接 Matrix Login API + 語言設定 Modal。
    *   [x] **客戶登入**：對接 Supabase Auth + Hub Provision API + 語言設定 Modal。
    *   [x] **客戶登入（基礎版）**：Email/Password + Hub `client/login` 與 `client/signup-provision` 串接。
    *   [x] **驗證**：確保兩端都能成功獲取 Token 並跳轉到主頁。
    *   [x] **Google 登录**：OAuth + 设置密码 + 可用 Email/ID 密码登录
    *   [x] **密码重置**：Supabase Email + /reset-password + Hub 同步 Matrix
    *   [x] **语言设置**：profiles.locale（Staff/Client 共用）
    *   [x] **客户注册扩展**：国家（必填）、公司、职位、性别、聊天语种 translation_locale

4.  **客户管理台（Hub Admin）**
    *   [x] **客户清单扩展字段**：User ID / 公司 / 职位 / 国家 / 性别 / 聊天语种
    *   [x] **同步逻辑调整**：客戶清單刷新 + 公司人员「全部公司」筛选 + 隐藏同步按钮

5.  **法务页面**
    *   [x] /privacy, /term（英文静态页）


---

## Phase 2: 核心聊天功能 (Core Chat)
**目標**：實現最基礎的 IM 功能（收發消息、房間列表）。

1.  **主佈局 (Layout)**
    *   [x] 實現 Sidebar (左側) + ChatArea (右側) 響應式佈局。
    *   [x] 實現 Sidebar 頂部「個人信息/設置」入口。
    *   [x] 手機端列表/詳情切換（列表在上方/內容在下方，點擊進入詳情/聊天，支持返回）。

2.  **房間列表 (RoomList)**
    *   [x] 獲取並渲染 `visibleRooms`。
    *   [x] 依 `m.direct` 顯示一對一房間列表（同用戶房間邏輯分組）。
    *   [x] 實現房間排序（按最後消息時間）。
    *   [x] 實現「搜索用戶」功能（調用 Hub API 查 Handle -> 發起 Invite/DM）。
    *   [x] 聯絡人詳情頁（基本資料 + Chat 入口 + 刪除入口）。
    *   [x] 聯絡人資料補充（性別/語言由 Hub 同一 API 帶回）。

3.  **聊天區域 (Timeline & Composer)**
    *   [x] 封裝 `useRoomTimeline` Hook。
    *   [x] 實現 `MessageBubble`：基礎文本/圖片渲染。
    *   [x] 實現 `MessageComposer`：發送文本消息（含 Optimistic UI）。
    *   [x] 輸入框快捷鍵：Enter 發送、Ctrl+Enter 換行。
    *   [x] **驗證**：確保 A、B 兩用戶能互發消息，且實時更新。

4.  **群聊與邀請流程（2026-02-09 ~ 2026-02-11）**
    *   [x] 建立群聊、群聊列表分類（`room_kind`）。
    *   [x] 群聊邀請卡片（接受/拒絕）與進房流程。
    *   [x] 邀請權限開關（Allow Members to Invite）與成員邀請。
    *   [x] 群成員管理：房主移除成員、普通成員離開群聊。
    *   [x] 針對「接受邀請後需刷新才進房」做多輪修復（sync 延遲、active room 切換、timeline 綁定）。
    *   [x] 群內系統通知：顯示成員離開/被移除訊息（含時間）。
    *   [x] 被移除成員彈窗通知（已修復刷新後重播舊通知問題）。


---

## Phase 3: 翻譯與業務邏輯 (Translation & Business Logic)
**目標**：接入 Hub 翻譯 API，實現 v2 核心的自動/手動翻譯邏輯。

1.  **翻譯 API 對接**
    *   [x] 封裝 Hub 翻譯接口 (`POST /translate`)。
    *   [x] 建立翻譯緩存機制（Hub 端 message translation cache + UI 端會話內緩存）。

2.  **自動翻譯 (Client ↔ Staff)**
    *   [x] **Staff 發送預熱**：不阻塞送出，先發原文並異步預熱譯文（避免等待時間）。
    *   [x] **私聊接收渲染**：按角色/公司規則判斷後，自動調用翻譯並在 Bubble 顯示譯文。

3.  **手動翻譯 (Staff ↔ Staff)**
    *   [x] 在 `MessageBubble` 增加譯文切換按鈕（原文/譯文切換）。
    *   [x] 點擊觸發翻譯並顯示（staff ↔ staff 不同公司）。
    
4.  **聯調驗證（2026-02-08）**
    *   [x] `client <- staff`：可翻譯（目標語言日文）。
    *   [x] `staff <- client`：可翻譯（目標語言日文）。
    *   [x] `staff <- 同公司 staff`：禁止翻譯（`TRANSLATION_NOT_ALLOWED`）。
    *   [x] 刷新後走 Hub 緩存命中，不重跑 LLM 翻譯（依 `room_id + message_id + target_lang + source_hash`）。


---

## Phase 4: 優化與交付 (Polish & Delivery)
**目標**：提升體驗，處理邊緣情況，準備交付。

1.  **UI/UX 優化**
    *   [x] 消息發送狀態 (Sending/Failed；已送出以時間顯示)。
    *   [x] 圖片/影片預覽。
    *   [ ] 文件下載（附件下載鏈路）與權限提示。
    *   [ ] 錯誤提示 (Toast)。
    *   [x] 聊天輸入框 Emoji 面板（已改為單列表展示）。

2.  **拓展模組預留**
    *   [ ] 在 Sidebar 增加 Voice/Video 按鈕（點擊提示）。

3.  **打包與部署**
    *   [ ] 構建 Docker Image (Nginx 託管靜態文件)。
    *   [ ] 最終驗收測試 (UAT)。

---

## 下一階段建議（截至 2026-02-11）

1.  **穩定性優先（P0）**
    *   [x] 完成一輪「群聊邀請/退出/移除」回歸測試實跑（2026-02-11，含多輪邀請、離開後再邀、被移除再邀回）。
    *   [x] 增加前端事件追蹤（加入群聊、membership 變更、activeRoomId 切換）便於線上排錯（debug 開關）。

2.  **體驗補齊（P1）**
    *   補齊 Toast 系統，統一成功/失敗提示，降低「無反應」感知。
    *   完成附件下載能力（圖片外的文件型別）與錯誤提示。

3.  **交付準備（P1）**
    *   製作前端部署鏡像（Nginx）與環境配置模板。
    *   進行一次 UAT 清單驗收（Client/Staff/群聊/翻譯/移除流程）。

---

## 回歸測試記錄（2026-02-11）

*   測試帳號：`test.john / test.sean / test.jack`
*   測試環境：`https://matrix.hululucky.com`
*   測試項目：邀請、加入、離開、移除（kick）、再邀請再加入、Allow Members to Invite 開關驗證
*   結果：核心流程 PASS（API 與 membership 狀態符合預期）

---

## 最新進度（截至 2026-02-13）

1. **已完成**
   *   [x] `continuwuity` 補齊 `/_matrix/client/v3|v1/media/delete/{serverName}/{mediaId}`，並已部署上線。
   *   [x] 線上回歸中 `file-media-delete` 已 PASS（不再是 `M_UNRECOGNIZED` WARN）。
   *   [x] 清理正式環境前端調試輸出（聊天室列表 debug log），追蹤訊息改為僅 DEV 模式輸出。

2. **下一步優先（P1）**
   *   [ ] 完成附件功能 UI/E2E 驗收清單（私聊/群聊/檔案中心/批量刪除）。
   *   [ ] 補齊 Toast 系統，統一成功/失敗提示文案。
   *   [ ] 完成前端部署鏡像（Nginx）與 UAT 驗收。

3. **執行清單（新增）**
   *   [x] 新增可執行 UAT/回歸表：`docs/plan/UAT-Regression-Checklist-v1.0.md`
   *   [ ] 依清單逐項執行並回填結果（Toast / 中斷恢復 / 性能 / Nginx+UAT / UI vs Element）。

