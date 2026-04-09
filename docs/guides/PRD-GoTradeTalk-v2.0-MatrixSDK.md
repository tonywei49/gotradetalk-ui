# PRD v2.0：GoTradeTalk 聚合平台 + 自研 UI 客户端（基于 matrix-js-sdk）

> **版本**：v2.0
> **基於**：PRD v1.1
> **核心變更**：
> 1.  **UI 重構**：不再 Fork Element Web，改為使用 `matrix-js-sdk` 從零搭建 React UI (`gotradetalk-ui`)。
> 2.  **移除加密**：完全移除端對端加密 (E2EE) 相關功能與 UI。
> 3.  **保留拓展**：預留語音/視頻通話模組接口。
> 4.  PRD-GoTradeTalk-v1.1.md僅作為後端數據結構的參考.
---

## 1. 背景與目標

### 1.1 背景
原 v1 方案計劃基於 Element Web 二次開發，但考慮到 Element 代碼庫過於龐大且包含大量不需要的加密/遺留功能，維護與定製成本過高。
v2 方案決定採用 **Headless SDK (`matrix-js-sdk`) + 自研 UI** 的方式，打造輕量、專注於商務溝通的客戶端。

### 1.2 目標
構建一個「企業自建 HS + 公共 HS 承載客戶 + 聚合平台做目錄/賬號/計費/翻譯調度」的商務溝通平台客戶端。
**關鍵原則**：
*   **輕量化**：僅保留商務溝通核心功能，去除 E2EE。
*   **雙入口**：同一客戶端支持「客戶（Client）」與「員工（Staff）」兩種登入模式。
*   **可拓展**：架構上預留未來接入 WebRTC 音視頻的能力。

---

## 2. 產品範圍 (Scope)

### 2.1 核心功能（v2 必做）

### 2.1 核心功能（v2 必做）

#### 1. 雙模式登入（Dual Entry）
客戶端啟動頁需清晰區分兩種身份入口，並在註冊/登入階段綁定**溝通語種**：

*   **客戶入口 (Client Entry)**
    *   **認證方式**：Supabase Auth (Email / Google)。
    *   **流程**：
        1.  用戶註冊/登入 Supabase。
        2.  **設定語種**：選擇偏好語言（如：繁體中文、English、日本語）。
        3.  調用 Hub API 自動配置/獲取 Matrix 賬號（將語種寫入 Profile）。
        4.  自動登入 Matrix。
    *   **Home Server**：預設指向公共 HS（如 `matrix.gotradetalk.com`），代碼可配置。
    *   **體驗**：無感知 Matrix，無需輸入 HS URL。

*   **員工入口 (Staff Entry)**
    *   **認證方式**：Matrix 原生登入 (User/Password)。
    *   **流程**：
        1.  輸入公司 HS 地址 + 賬號 + 密碼。
        2.  登入成功。
        3.  **設定語種**：若首次登入或未設定，提示選擇工作語言。
    *   **賬號來源**：由公司管理員創建。

#### 2. 即時通訊 (IM)
*   **會話列表**：展示 DM (Direct Message) 房間。
*   **消息收發**：支持文本、圖片、文件。
*   **消息狀態**：發送中、已發送、發送失敗。
*   **歷史記錄**：基於 Matrix Timeline 加載歷史消息。
*   **搜索與發起**：
    *   輸入 `company.user` (Handle) 查找用戶。
    *   解析 Handle -> Matrix ID (通過 Hub API)。
    *   發起 DM 邀請 (Invite)。

#### 3. 翻譯功能 (Translation) - **核心優化**
翻譯功能根據**對話雙方身份**自動或手動觸發，計費邏輯嚴格區分。

*   **場景 A：客戶 (Client) ↔ 公司 (Staff)**
    *   **公司發送給客戶**：
        *   員工輸入母語文字 -> 系統自動調用 LLM 翻譯（目標語言為客戶設定的語種）-> **原文 + 譯文** 一併發送給客戶。
        *   *計費*：算公司。
    *   **客戶發送給公司**：
        *   客戶發送文字（原文）。
        *   員工端收到消息 -> 系統自動調用 LLM 翻譯（目標語言為員工設定的語種）-> 員工端界面顯示 **原文 + 譯文**。
        *   *計費*：算公司。
*   **場景 B：公司 (Staff A) ↔ 公司 (Staff B)**
    *   **各自翻譯**：默認不自動翻譯。
    *   **手動觸發**：接收方可點擊「翻譯」按鈕，翻譯成自己的語言。
    *   *計費*：誰發起翻譯請求，誰所屬的公司付費。
*   **場景 C：客戶 ↔ 客戶 / 同公司內部**
    *   無翻譯功能。
*   **場景 D：自己公司內部對話**
    *   無翻譯功能。

*   **設置**：用戶可在「設置」頁面隨時修改**溝通語種**。

#### 4. 拓展功能預留 (Extensions)
*   **UI 佈局**：預留側邊欄或頂部功能區，用於掛載額外模組。
*   **模組佔位**：
    *   語音通話 (Voice Call)
    *   視頻通話 (Video Call)
    *   *注：v2.0 僅需安裝依賴並預留 UI 入口/按鈕，點擊可提示「敬請期待」。*

### 2.2 明確排除 (Out of Scope)
*   **端對端加密 (E2EE)**：
    *   **禁止**：初始化 SDK 時必須關閉 crypto。
    *   **移除**：UI 中不得出現「驗證設備」、「安全備份」、「Cross-signing」等提示。
*   **複雜的房間管理**：v1/v2 僅專注於 DM (1v1)，暫不處理複雜的群組權限/Space。
*   **VoIP 完整實現**：v2.0 僅預留，不實作具體信令與流媒體處理。

---

## 3. 用戶體驗流程 (User Flow)

### 3.1 客戶旅程
1.  打開 App，選擇「我是客戶」。
2.  輸入 Email/Google 登入 (Supabase Auth)。
3.  **選擇溝通語言**（如未設置）。
4.  (首次) 系統自動分配 `gotradetalk.user` 賬號並登入。
5.  進入主界面，搜索 `company.agent` 發起諮詢。
6.  收到公司回復時，直接看到「原文 + 譯文」。

### 3.2 員工旅程
1.  打開 App，選擇「我是員工」。
2.  輸入公司 HS 地址、賬號、密碼登入。
3.  **確認工作語言**。
4.  進入主界面。
5.  收到客戶消息時，界面自動顯示「原文 + 譯文」。
6.  回復客戶時，輸入母語，系統自動附加譯文發送。

---

## 4. 技術要求 (Technical Requirements)

### 4.1 架構棧
*   **Framework**: React 18+
*   **Build Tool**: Vite
*   **Core SDK**: `matrix-js-sdk` (Headless)
*   **Auth**: `@supabase/supabase-js` (用於客戶端 Auth)
*   **State Management**: React Context / Zustand (替代 Element 的 Flux)
*   **Styling**: CSS Modules / Tailwind (可選，保持簡潔)

### 4.2 安全與隱私
*   **No Crypto**: 確保 `MatrixClient.initCrypto()` **永遠不被調用**。
*   **Token 存儲**:
    *   Client: Supabase Session + Matrix Access Token (存 localStorage/sessionStorage)。
    *   Staff: Matrix Access Token (存 localStorage)。

### 4.3 性能指標
*   **首屏加載**：< 1.5s (相比 Element Web 的數秒加載，自研 UI 應顯著更快)。
*   **消息發送延遲**：UI 響應 < 100ms (樂觀更新)。

---

## 5. 交付物
1.  **源代碼**：`gotradetalk-ui` (完整的前端工程)。
2.  **文檔**：
    *   `PRD-GoTradeTalk-v2.0-MatrixSDK.md` (本文檔)
    *   `Specs-GoTradeTalk-v2.0-MatrixSDK.md` (技術規格書)
