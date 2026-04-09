# Specs v2.0：GoTradeTalk 自研客户端技术规格书

> **版本**：v2.0
> **适用项目**：`gotradetalk-ui`
> **核心依赖**：React 18, matrix-js-sdk, supabase-js

---

## 1. 技术栈与工程结构

### 1.1 核心技术栈
*   **构建工具**：Vite (React + TypeScript)
*   **Matrix SDK**：`matrix-js-sdk` (v34+)
*   **Auth**：`@supabase/supabase-js` (仅用于 Client 端认证)
*   **UI 框架**：React 18 (Hooks 优先)
*   **样式方案**：CSS Modules 或 Tailwind CSS (推荐 Tailwind 以加速开发)
*   **状态管理**：Zustand (轻量级，适合替代 Redux/Flux)
*   **路由**：React Router v6

### 1.2 目录结构建议
```
gotradetalk-ui/
├── src/
│   ├── api/                # Hub API 封装 (Supabase Edge Functions 调用)
│   ├── components/         # 通用 UI 组件 (Button, Input, Modal)
│   ├── features/           # 业务功能模块
│   │   ├── auth/           # 登录/注册 (Client & Staff)
│   │   ├── chat/           # 聊天核心 (Timeline, Composer)
│   │   ├── room-list/      # 房间列表
│   │   └── extensions/     # 拓展模块 (Voice/Video 占位)
│   ├── hooks/              # 自定义 Hooks (useMatrixClient, useRoomState)
│   ├── layouts/            # 页面布局 (MainLayout, AuthLayout)
│   ├── matrix/             # Matrix SDK 封装与初始化
│   ├── pages/              # 页面入口
│   ├── stores/             # Zustand Stores (AuthStore, RoomStore)
│   └── utils/              # 工具函数
├── .env                    # 环境变量 (VITE_HUB_URL, VITE_DEFAULT_HS_URL)
└── package.json
```

---

## 2. Matrix SDK 初始化与无加密配置

### 2.1 初始化逻辑
必须确保 **不加载** crypto 模块。

```typescript
// src/matrix/client.ts
import * as sdk from "matrix-js-sdk";

export const createMatrixClient = (baseUrl: string, accessToken: string, userId: string) => {
  const client = sdk.createClient({
    baseUrl,
    accessToken,
    userId,
    // 关键：显式关闭加密相关配置（虽然 createClient 默认不开启，但需确保不调用 initCrypto）
    timelineSupport: true, // 开启时间线支持
  });

  // 启动客户端
  client.startClient({ initialSyncLimit: 20 });
  
  return client;
};
```

### 2.2 禁止调用
在全工程范围内，禁止调用以下 API：
*   `client.initCrypto()`
*   `client.setGlobalErrorOnUnknownDevices()`
*   `client.downloadKeys()`

---

## 3. 认证流程 (Authentication)

### 3.1 状态管理 (AuthStore)
使用 Zustand 管理当前登录状态：
```typescript
interface AuthState {
  isAuthenticated: boolean;
  userType: 'client' | 'staff' | null;
  preferredLanguage: string; // e.g., 'zh-TW', 'en-US'
  matrixClient: MatrixClient | null;
  userProfile: {
    userId: string;
    displayName: string;
    avatarUrl?: string;
  } | null;
  login: (params: LoginParams) => Promise<void>;
  updateLanguage: (lang: string) => Promise<void>; // 更新语言设置（同步到 Hub/Local）
  logout: () => void;
}
```

### 3.2 客户登录 (Client Flow)
1.  **UI**: `AuthPage` -> Tab "我是客户"。
2.  **Action**: 用户点击 "Google 登录" 或输入邮箱。
3.  **Supabase**: `supabase.auth.signInWithOAuth(...)`。
4.  **Language**: 检查 Profile 是否有 `preferred_language`，无则弹出 Modal 让用户选择。
5.  **Provision**: 调用 Hub API `POST /client/provision` (带 Supabase Token + Language)。
    *   Hub 检查/创建 Matrix 账号，保存语言偏好。
    *   Hub 返回 Matrix `access_token`, `user_id`, `home_server_url`。
6.  **Init**: 使用返回的凭据初始化 Matrix Client。

### 3.3 员工登录 (Staff Flow)
1.  **UI**: `AuthPage` -> Tab "我是员工"。
2.  **Input**: HS URL, Username, Password。
3.  **Action**: `tempClient.login(...)`。
4.  **Language**: 登录成功后，从 LocalStorage 或 Hub (通过 `GET /staff/profile`) 获取 `preferred_language`。若无，弹出 Modal 让用户选择并保存。
5.  **Init**: 初始化正式 Matrix Client。

---

## 4. 核心 UI 模块规格

### 4.1 主布局 (MainLayout)
*   **Sidebar**:
    *   顶部：个人头像/设置入口（包含 **语言设置**）。
    *   中部：房间列表 (RoomList)。
    *   底部：拓展功能入口。
*   **Content**:
    *   聊天区：`ChatRoom` 组件。

### 4.2 房间列表 (RoomList)
*   **数据源**: `client.getVisibleRooms()`。
*   **排序**: 按最后消息时间倒序。
*   **搜索**: 本地过滤 + 远程搜索。

### 4.3 聊天区 (ChatRoom)
*   **Header**: 房间名、在线状态。
*   **Timeline**: `MessageBubble` 需支持 "原文 + 译文" 的双重显示模式。
*   **Composer**:
    *   **发送逻辑拦截**：
        *   若当前是 **Staff** 且对方是 **Client**：
            1.  锁定发送按钮 (Loading)。
            2.  调用 Hub 翻译 API (Input Text -> Client's Lang)。
            3.  拼接消息：`Input Text \n\n----------------\n\n [Translation] \n Translated Text` (格式待定)。
            4.  调用 `client.sendEvent` 发送拼接后的消息。
        *   其他情况：直接发送。

### 4.4 翻译交互 (Translation Logic)

*   **场景 1：Staff 接收 Client 消息**
    *   **触发**：监听 `Room.timeline` 事件。
    *   **判断**：若 `sender` 是 Client (通过 Hub 查或 Room Account Data 标记) 且 `receiver` 是 Staff。
    *   **动作**：
        *   自动调用 Hub 翻译 API (Message Content -> Staff's Lang)。
        *   **不修改 Matrix Event**，而是将译文存入本地状态 (Zustand `TranslationStore` 或 React Query Cache)，Key 为 `event_id`。
    *   **渲染**：`MessageBubble` 检测到有缓存的译文，自动在原文下方显示。

*   **场景 2：Company <-> Company**
    *   **触发**：手动点击消息旁的 "翻译" 按钮。
    *   **动作**：调 Hub API -> 存本地状态 -> 显示。

*   **场景 3：Client 接收 Company 消息**
    *   **渲染**：由于 Staff 发送时已拼接了译文，Client 端无需特殊处理，直接显示即可（或者 UI 做一些格式化美化，识别分隔符）。

---

## 5. 好友請求與房間創建流程

### 5.1 設計背景

Matrix 協議本身沒有「加好友」概念，只有「邀請進入聊天室」。為了對齊現代聊天工具的使用習慣，我們在 Hub 層增加了好友系統，並將「加好友」映射為「創建 DM 房間並邀請對方」。

### 5.2 核心設計原則

1. **請求方創建房間**：發送好友請求時，請求方負責創建 Matrix DM 房間
2. **初始消息必填**：創建房間時必須發送一條初始消息（確保邀請事件正確同步）
3. **接受方加入房間**：接受好友請求時，接受方加入請求方創建的房間（而非創建新房間）
4. **房間建立**：刪除好友後重新添加會建立新聊天室，不復用舊房間（舊房間僅從 `m.direct` 隱藏）

### 5.3 流程圖

```
發送好友請求（請求方 A）：
A 創建 DM 房間 → 發送初始消息 → 調用 Hub API（含 room_id）→ 等待 B 接受

接受好友請求（接受方 B）：
B 調用 Hub API → 獲取 room_id → 加入 A 創建的房間 → 開始聊天
```

### 5.4 Hub API 變更

#### `POST /contacts/request`
| 參數 | 類型 | 說明 |
|------|------|------|
| `target_id` | string | 目標用戶 ID |
| `initial_message` | string | 初始消息（必填） |
| `matrix_room_id` | string | 請求方創建的 Matrix 房間 ID |

#### `POST /contacts/accept`
| 返回欄位 | 類型 | 說明 |
|---------|------|------|
| `status` | string | 狀態（`accepted`） |
| `matrix_room_id` | string | 請求方創建的房間 ID，接受方需加入此房間 |

### 5.5 前端實現要點

#### `createDirectRoomWithMessage` 函數
```typescript
// 創建房間並發送初始消息
export async function createDirectRoomWithMessage(
    client: MatrixClient,
    userId: string,
    message: string,
): Promise<string> {
    // 1. 檢查是否已有現有房間可複用（若已加入則可直接使用）
    // 2. 否則創建新房間並邀請對方
    // 3. 更新 m.direct account data
    // 4. 發送初始消息（觸發邀請同步）
    // 5. 返回房間 ID
}
```

#### `joinDirectRoom` 函數
```typescript
// 加入已存在的 DM 房間
export async function joinDirectRoom(
    client: MatrixClient,
    roomId: string,
    userId: string,
): Promise<void> {
    // 1. 加入房間
    // 2. 更新 m.direct account data
}
```

### 5.6 UI 交互

1. **搜索用戶**：點擊「+」按鈕後，顯示消息輸入框
2. **輸入消息**：用戶必須輸入打招呼消息
3. **發送請求**：點擊「發送請求」後，創建房間並調用 Hub API
4. **接受請求**：點擊「Accept」後，加入房間並進入聊天

---

## 5. 拓展模块接口 (Extension Interface)

虽然 v2 不实现通话，但需定义接口文件 `src/features/extensions/types.ts`：

```typescript
export interface ExtensionModule {
  id: string;
  name: string;
  icon: React.ComponentType;
  onActivate: (context: ExtensionContext) => void;
}

export interface ExtensionContext {
  matrixClient: MatrixClient;
  currentRoomId?: string;
}
```

在 Sidebar 中遍历渲染这些模块入口。

---

## 6. 环境变量配置 (.env)

```ini
# Hub 后端地址 (用于 Client Provision, 搜索, 翻译)
VITE_HUB_API_URL=https://hub.gotradetalk.com/api

# Supabase 配置 (Client Auth)
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...

# 默认公共 HS (用于 Client 登录时的 fallback 或显示)
VITE_DEFAULT_PUBLIC_HS=https://matrix.gotradetalk.com
```

---

## 7. 开发注意事项
1.  **React Strict Mode**: Matrix SDK 在 Strict Mode 下可能会有双重初始化问题，需在 `useEffect` 中妥善处理 `client.stopClient()` 清理逻辑。
2.  **类型安全**: 尽量使用 `matrix-js-sdk` 导出的类型 (e.g., `MatrixEvent`, `Room`)。
3.  **错误处理**: 统一拦截 API 错误，区分 Network Error 和 Matrix Error (如 M_FORBIDDEN)。
