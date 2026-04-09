# GoTradeTalk 会话与设备管控开发计划

## 1. 目标

1. 客户端账号支持“抢占式登录”。
2. 新设备登录成功后，自动使同槽位旧设备失效，而不是等待旧设备手动退出。
3. 保留现有登录方式，包括 Email/Password 与 Google OAuth，不因会话管控而取消。
4. 将改动控制在登录鉴权链路，不重构聊天、笔记、联系人等现有业务功能。

## 2. 目标规则定义

### 2.1 会话槽位

建议按以下槽位管理并发：

- `mobile`：同账号最多 1 个活跃会话
- `computer`：同账号最多 1 个活跃会话

说明：

1. `computer` 同时覆盖桌面应用与网页端，满足“一个账号最多同时登录手机和一台电脑”。
2. 如果后续业务确认网页端应独立于桌面端，再拆分为 `desktop` 与 `web` 两个槽位。

### 2.2 抢占式策略

1. 新登录优先成功。
2. 同槽位旧会话在新登录成功后被标记为 `revoked`。
3. 被踢设备后续请求任一受保护接口时，收到统一错误码并回到登录页。
4. 如条件允许，同步下线旧 Matrix 设备，减少旧 token 残留可用时间。

## 3. 范围边界

### 3.1 本期纳入

1. `hub-backend` 增加会话记录与抢占逻辑。
2. `gotradetalk-ui` 登录时上报设备类型与设备标识。
3. `gotradetalk-ui` 统一处理 `SESSION_REVOKED` 等会话失效错误。
4. Tauri 桌面端补单实例，避免同机无限开进程。

### 3.2 本期不做

1. 不取消 Google 登录。
2. 不强制所有用户改为邮箱注册。
3. 不修改聊天、翻译、笔记、文件中心核心业务流程。
4. 不在第一阶段引入复杂的实时消息推送踢线机制。

## 4. 当前现状

1. 前端当前只持久化 `hubSession` 与 `matrixCredentials`，未维护“会话槽位”概念。
2. `hub-backend` 当前 `POST /client/login` 每次都会新签发 Supabase 会话并执行 Matrix 登录，未限制并发。
3. 现有前端清会话逻辑仅在 token 过期、whoami 校验失败或用户主动退出时触发。
4. 桌面端当前未实现单实例控制。

## 5. 实施计划表

| 编号 | 阶段 | 交付结果 | 关键改动 | 验收标准 | 预计工时 |
|---|---|---|---|---|---|
| 1 | 规则冻结 | 会话模型与设备槽位确认 | 确认 `mobile/computer` 方案、错误码、顶号策略 | 产品/开发对并发规则无歧义 | 0.5 天 |
| 2 | 数据层建设 | 新增会话表可记录活跃设备 | 增加 `user_device_sessions` 表与索引；定义状态流转 | 能查询任一账号当前活跃槽位 | 0.5-1 天 |
| 3 | 登录链路升级 | 新登录可覆盖旧登录 | 改造 `POST /client/login`，先写新会话，再撤销同槽位旧会话 | A 端登录后，B 端同槽位被判失效 | 1-1.5 天 |
| 4 | 鉴权校验补齐 | 旧设备不可继续访问业务接口 | 在 Hub 受保护接口增加 active session 校验 | 被踢旧设备请求接口收到统一错误码 | 1-2 天 |
| 5 | 前端登录参数上报 | 前端可区分手机/电脑与设备指纹 | 登录请求增加 `session_slot`、`device_fingerprint`、`device_name`、`platform` | 后端日志可识别具体登录来源 | 0.5-1 天 |
| 6 | 前端踢线处理 | 被踢后自动清会话并跳登录 | 全局拦截 `SESSION_REVOKED`，提示并清本地状态 | 旧设备无须刷新即可在下次请求后退出 | 0.5-1 天 |
| 7 | Matrix 旧设备下线 | 旧 Matrix 设备被同步踢出 | 记录 `matrix_device_id`，尝试调用管理能力下线旧设备 | 旧端 Matrix 操作尽快失效 | 1-2 天 |
| 8 | 桌面单实例 | 同机不可无限开多个应用进程 | `src-tauri` 增加单实例处理与唤起主窗口 | macOS/Windows 同机重复打开只保留一个实例 | 0.5-1 天 |
| 9 | 联调与回归 | 登录与顶号行为稳定 | 覆盖 Email/Password、Google OAuth、桌面端、网页端回归 | 核心抢占场景全部通过 | 1-2 天 |

## 6. 数据设计建议

### 6.1 建议新表：`user_device_sessions`

建议字段：

- `id`
- `auth_user_id`
- `profile_id`
- `user_type`
- `session_slot` (`mobile` / `computer`)
- `platform` (`ios` / `android` / `web` / `windows` / `macos`)
- `device_fingerprint`
- `device_name`
- `matrix_user_id`
- `matrix_device_id`
- `hub_access_token_jti` 或等价可识别字段
- `refresh_token_hash`
- `status` (`active` / `revoked` / `logged_out` / `expired`)
- `revoked_by_session_id`
- `revoked_reason`
- `last_seen_at`
- `created_at`
- `updated_at`

### 6.2 关键索引

1. `auth_user_id + session_slot + status`
2. `auth_user_id + device_fingerprint`
3. `matrix_user_id + matrix_device_id`

## 7. 后端改造要点

### 7.1 `POST /client/login`

目标行为：

1. 先完成现有身份认证。
2. 解析本次登录所属槽位。
3. 查找同账号同槽位的 `active` 会话。
4. 创建新会话记录。
5. 将旧会话批量置为 `revoked`。
6. 返回新的 Matrix + Supabase 会话信息。

### 7.2 受保护接口鉴权

新增统一校验逻辑：

1. 从请求中识别当前会话。
2. 到 `user_device_sessions` 查询是否仍为 `active`。
3. 若已被顶下线，返回统一错误码，例如：
   - `401`
   - `code: SESSION_REVOKED`
4. 前端接到该错误后执行强制下线。

### 7.3 Matrix 设备处理

分两步执行：

1. 第一阶段：先做业务层失效，确保 Hub 接口全部不可用。
2. 第二阶段：补做旧 `matrix_device_id` 下线，缩短旧 Matrix token 生效窗口。

## 8. 前端改造要点

### 8.1 登录参数

在现有登录请求中补充：

- `session_slot`
- `platform`
- `device_name`
- `device_fingerprint`
- `app_variant`（可选：`tauri` / `web`）

### 8.2 全局失效处理

前端需统一处理：

1. Hub API 返回 `SESSION_REVOKED`
2. Matrix `whoami` 失败
3. Refresh Session 失败

处理动作：

1. 清空本地 `hubSession`
2. 清空本地 `matrixCredentials`
3. 跳转 `/auth`
4. Toast 提示“账号已在其他设备登录”

### 8.3 桌面单实例

目标：

1. 桌面应用同一台机器只允许一个实例存活。
2. 二次启动时唤起已存在窗口，而不是打开第二个进程。

## 9. 兼容性与风险

### 9.1 兼容性结论

1. 现有 Email/Password 登录保留。
2. 现有 Google OAuth 登录保留。
3. 业务功能接口不改语义，仅补会话有效性检查。
4. 属于鉴权升级，不是账号体系重构。

### 9.2 主要风险

1. 如果只做登录时撤销、不做接口校验，旧 token 可能短时间继续可用。
2. 如果 Hub 撤销了会话但 Matrix 旧设备未下线，旧设备可能还能直接走 Matrix SDK。
3. Google OAuth 与 Email/Password 若未统一收口到同一 session manager，可能产生绕过。
4. 设备指纹算法若不稳定，会导致同一设备频繁被识别为新设备。

## 10. 分期建议

### Phase 1：最小可上线版

1. 新增会话表。
2. 改造 `/client/login` 抢占旧会话。
3. Hub 关键接口校验 `active session`。
4. 前端统一处理 `SESSION_REVOKED`。

目标：

1. 先实现“新设备登录，旧设备被踢”。
2. 先保证业务层不可继续使用。

### Phase 2：完整体验版

1. Matrix 旧设备同步下线。
2. 桌面端单实例。
3. 登录历史/设备管理页（可选）。
4. 更细的踢线提示与审计日志。

目标：

1. 补齐 Matrix token 残留问题。
2. 降低支持与排障成本。

## 11. 验收清单

1. 同账号手机 A 登录后，手机 B 登录，手机 A 被踢下线。
2. 同账号桌面端 A 登录后，网页端 B 登录，桌面端 A 被踢下线。
3. 同账号手机端与电脑端可同时在线，各保留 1 个槽位。
4. Google 登录与邮箱登录均受相同并发规则约束。
5. 被踢设备再次操作聊天、笔记、联系人等受保护接口时，统一跳登录页。
6. 桌面端重复打开应用时，不产生多个独立进程会话。

## 12. 建议执行顺序

1. 先完成 Phase 1，再决定是否进入 Phase 2。
2. 先做 `computer` 合并槽位，减少规则复杂度。
3. 先打通 Hub 业务层踢线，再补 Matrix 真下线。
4. 回归通过后再考虑做“设备管理页面”给运营或用户查看。
