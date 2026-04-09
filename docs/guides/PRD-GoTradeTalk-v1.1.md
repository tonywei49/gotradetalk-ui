# PRD v1：GoTradeTalk 聚合平台 + 桌面端沟通应用（Continuwuity + Element 二开）
# 開發客戶端 (gotradetalk-ui) 時,請只看 v2.0，此文件僅作為後端數據結構的參考.
> 目标：构建一个“企业自建 HS + 公共 HS 承载客户 + 聚合平台做目录/账号/计费/翻译调度”的商务沟通平台。
> 关键原则：聚合平台不存储聊天内容；聊天内容仅存在各自 HS 与客户端缓存。

---

## 1. 背景与问题

### 1.1 当前痛点

* Matrix 原生使用门槛高：用户需输入长 ID（如 `@user:server`），企业与客户对接成本高。
* 多公司、多 HS 场景下：账号创建、目录同步、翻译计费与功能开关缺乏统一管理入口。
* 企业希望私有部署（公司 HS）以避免数据外流；客户未部署 HS 需公共 HS 承载。

### 1.2 机会点

* Continuwuity 部署/运维更轻量，可作为公司端 HS 标配。
* 通过聚合平台（Hub）实现：

  * 公司与人员目录（可搜索 `company.user`）
  * Hub 代创建账号（公共 HS + 公司 HS）
  * 翻译由 Hub 统一鉴权/调度/计费

---

## 2. 产品范围

### 2.1 v1 必做范围（本 PRD 覆盖）

1. **平台管理员后台（Platform Admin）**

* 创建公司（company_slug 唯一）
* 创建公司管理员账号
* 配置公司 HS 域名（hs_domain）、状态、订阅（翻译开关/额度）
* 查看公司用量日志（翻译用量为主）

2. **公司管理后台（Company Admin Console）**

* 公司管理员登录
* 员工账号管理：新增/删除/停用/重置（以 Hub 为权威源）
* 同步员工到公司 HS（由 Hub 执行创建/停用）
* 员工存储配额：按用户配置（超额禁上传）

3. **桌面应用（单一安装包，双入口）**

* 客户入口：固定公共 HS（`matrix.gotradetalk.com`），不展示可选项
* 公司员工入口：需输入公司 HS 地址（hs_domain）
* 搜索与发起会话：通过输入 `company.user` 查找并发起 DM
* DM 机制：邀请即请求（对方接受后可聊天）

4. **即时翻译（Company 付费，Hub 调度）**

* 翻译请求仅走 Supabase Edge Function（不直连 DeepSeek）
* 鉴权：按“发起翻译请求方所属公司”检查订阅状态
* 不落库正文：仅存用量日志
* 公司对公司：各自翻各自的（请求方付费）

5. **知识库检索（公司端）**

Company Admin Console 增加配置项：
RAG_API_ENDPOINT
RAG_API_KEY
配置保存到 Hub（仅公司管理员可读写，RLS 限制）
Agent 启动时拉取配置（或由 Hub 推送配置更新）
流程：
桌面端（Staff）发起检索请求 → 发给 Agent（内网）
Agent 读取配置 → 转发请求给 Bisheng/RAGFlow（或统一 RAG 网关）
返回检索结果给桌面端展示
员工手动复制/一键发送（v1 仅展示，不自动发送）

6. **记事本与附件（基础版）**

* 公司端：SQLite，存于系统用户目录（确保更新不丢）
* 用戶端：存supabase，新增 notebooks 表（见数据模型更新），支持跨设备同步
* 附件：先本地盘存储（后续再对象存储）
* 配额：按用户；超额后禁止上传

### 2.2 v1 不做（明确排除）

* Web 端应用（仅桌面端）
* 客户对客户翻译
* 自动回复/自动发送知识库答案
* 复杂“好友系统/关系链”（v1 使用 DM 邀请机制）
* 对象存储、CDN、文件秒传等高级存储能力
* OTA/自动更新策略细化（仅保留扩展点）

---

## 3. 核心概念与标识体系

### 3.1 公司（Company）

* `company_slug`：平台唯一短名（由平台管理员创建，唯一性检查）
* `hs_domain`：公司 HS 实际域名（允许任意可达且证书有效的域名；建议 `matrix.<company-domain>`）
* `display_name`：公司展示名（可长/可中文）

### 3.2 用户（User）

* `user_local_id`：账号短 ID（例如 `tony`）
* **平台输入标识（Handle）**：`company_slug.user_local_id`（例：`abc.tony`）
* **Matrix user_id（最终路由）**：`@user_local_id:hs_domain`

### 3.3 客户（Client）统一公司名

* 客户在公共 HS：`hs_domain = matrix.gotradetalk.com`
* 客户在平台的 company_slug 固定：`gotradetalk`
* 客户 handle：`gotradetalk.jack`
* 客户 Matrix user_id：`@jack:matrix.gotradetalk.com`

---

## 4. 用户角色与权限

### 4.1 角色

* 平台管理员（Platform Admin）
* 公司管理员（Company Admin）
* 公司员工（Company Staff）
* 客户（Client User）

### 4.2 权限矩阵（v1）

| 功能                   | 平台管理员  | 公司管理员           | 公司员工     | 客户                      |
| -------------------- | ------ | --------------- | -------- | ----------------------- |
| 创建公司/配置 hs_domain    | ✅      | ❌               | ❌        | ❌                       |
| 创建公司管理员              | ✅      | ❌               | ❌        | ❌                       |
| 员工 CRUD（新增/删除/停用/重置） | ❌（可查看） | ✅               | ❌        | ❌                       |
| 员工同步到公司 HS           | ❌（可查看） | ✅（触发）           | ❌        | ❌                       |
| 搜索 company.user      | ✅（可查）  | ✅               | ✅        | ✅                       |
| DM 邀请/会话             | ✅      | ✅               | ✅        | ✅                       |
| 翻译调用                 | ❌      | ✅（使用人是员工/客户侧显示） | ✅（公司员工端） | ✅（仅“翻译公司发来的消息”展示；计费算公司） |
| 知识库检索                | ❌      | ✅               | ✅        | ❌                       |
| 记事本                  | ✅（仅自身） | ✅（自身）           | ✅        | ✅                       |
| 附件上传                 | ✅（自身）  | ✅（可配置配额）        | ✅        | ✅                       |

> 说明：客户“是否看到翻译”取决于消息方向与角色规则；计费始终算公司（请求方公司）。

---

## 5. 关键业务流程（v1）

### 5.1 平台开通公司（Platform Admin）

1. 平台管理员进入平台管理员后台
2. 创建公司：输入 `company_slug`（唯一性校验）、`hs_domain`、`display_name`
3. 创建公司管理员账号（绑定到该 company）
4. 配置翻译订阅状态（active / quota / 计费方案字段）
5. 公司管理员获得登录入口与初始凭据

**验收**

* company_slug 全平台唯一；重复创建被拒
* 公司记录可查询、可编辑 hs_domain
* 公司管理员账号可登录公司管理后台

---

### 5.2 公司管理员创建员工并同步到公司 HS

#### 5.2.1 规则

Hub 仅存员工记录与状态，不存密码
Hub 下发“设置初始密码/强制重置密码”的指令给 Agent
员工登录：桌面端输入 hs_domain + username/password，直接向公司 HS 验证

#### 5.2.2 初始密码/重置策略（v1）

公司管理员新增员工后，Hub 提供两种操作（任选其一作为 v1 默认）：
策略 A（推荐更简单）：管理员手动告知初始密码
Hub 创建员工记录 → 下发 CREATE_USER 给 Agent
Agent 在 HS 创建账号，并按 Hub 指令设置初始密码（由管理员填写）
员工首次登录触发强制改密（见 9.6）
策略 B（更自动化）：Hub 生成一次性临时密码（不落库）
Hub 生成临时密码，仅在界面显示一次（不写 DB）
Hub 下发给 Agent 设置到 HS
员工登录后强制改密（9.6）
v1 建议用策略 A，减少一次性密码的“传递链路”问题。

#### 5.2.3 员工状态字段（用于强制改密）

Hub 为每个员工维护一个状态：password_state = ACTIVE | RESET_REQUIRED
新建员工默认 RESET_REQUIRED
重置密码后也置为 RESET_REQUIRED

---

### 5.3 客户注册：Supabase Auth → Hub 代创建公共 HS 账号

1. 客户在桌面端选择“客户入口”
2. 使用 Supabase Auth（邮箱/Google）完成注册/登录
3. Hub（Edge Function）为该客户创建 Matrix 账号（公共 HS）
4. 返回该客户的 `handle = gotradetalk.user_local_id` 与 Matrix 凭据（仅用于客户端登录）

**验收**

* 客户无需输入 HS 地址；默认公共 HS
* 客户 user_local_id 在公共 HS 内唯一；冲突时提示改名

---

### 5.4 搜索与发起 DM（好友请求机制）

#### 5.4.1 基本流程

1. 任意用户在桌面端搜索框输入：`company.user`（例：`abc.tony`）
2. 客户端请求 Hub：解析 `company_slug → hs_domain`，拼出 `@user:hs_domain`
3. **用户点击「+」按钮，输入打招呼消息（必填）**
4. **客户端创建 DM 房间并发送初始消息**
5. **客户端将房间 ID 与初始消息提交给 Hub**
6. 对方接受 invite 后：加入该房间，双方可聊天

#### 5.4.2 设计决策

> **为何需要初始消息？**
> 
> Matrix 协议中，创建空房间后邀请对方，邀请事件可能不会立即同步到对方客户端。
> 发送一条消息可以确保邀请事件正确触发并同步。

| 设计原则 | 说明 |
|---------|------|
| **请求方创建房间** | 发送好友请求时，由请求方创建 Matrix DM 房间 |
| **初始消息必填** | 创建房间时必须发送一条消息，确保邀请同步 |
| **接受方加入房间** | 接受好友请求时，接受方加入请求方创建的房间 |
| **房间复用** | 同个聊天对象只存在一个聊天室，避免重复创建 |
| **删除好友 = 离开房间** | 删除好友后，用户离开房间但房间仍存在 |
| **重新添加优先复用** | 重新添加好友时，优先复用已存在的房间 |

#### 5.4.3 Hub API 参与

| API | 参数/返回 |
|-----|---------|
| `POST /contacts/request` | 需传递 `initial_message` 和 `matrix_room_id` |
| `POST /contacts/accept` | 返回 `matrix_room_id`，接受方需加入此房间 |
| `GET /contacts/requests` | 返回 `matrix_room_id` 供接受方使用 |

**验收**

* 搜索支持精确匹配 `company.user`
* 若目标不存在/停用：返回明确错误
* 邀请状态可视化（pending/accepted/rejected）
* **发送好友请求时必须输入打招呼消息**
* **接受方能在聊天室看到请求方的初始消息**

---

## 6. 即时翻译（v1 规则与实现）

### 6.1 触发规则（按你已定的业务）

* 客户端之间聊天：无翻译
* 客户 ↔ 公司：

  * 客户收到公司消息：可显示翻译（请求由客户侧发起，但计费算公司）
  * 公司员工收到客户消息：可显示翻译（请求由公司员工侧发起，计费算公司）
* 公司 ↔ 公司：各自翻各自的（谁发起翻译请求谁付费，主体为其所属公司）

### 6.2 技术链路（统一走 Edge Function）

前端请求：`{ text, target_lang }` → Supabase Edge Function：

1. 鉴权：识别当前用户所属 company_slug
2. 订阅检查：该 company 是否 `translation_subscription_active = true`
3. 调用 DeepSeek（key 存在 Supabase 环境变量/Vault）
4. 返回译文

### 6.3 计费与日志（不落库正文）

* 不保存原文/译文正文
* 只保存：请求时间、company_slug、user_id、tokens/字符数、目标语言、模型、耗时、状态码

**验收**

* 未订阅：Edge Function 拒绝并返回可读错误
* 订阅有效：稳定返回译文
* 用量日志可按公司聚合查看

---

## 7. 账号创建与 HS 同步机制（v1）

### 7.1 账号“权威源”

* Hub（Supabase 数据库）是权威源：公司、公司管理员、员工、客户档案均由 Hub 管
* Matrix HS 是执行端：创建/停用/同步由 Hub 触发

### 7.2 HS 账号创建与同步机制
目标：不暴露公司 HS Admin API 到公网；Hub 仍然是“权威源”，但所有 HS 管理动作由公司内网 Agent 代执行。

#### 7.2.1 架构

公司端部署包包含一个常驻服务：GoTrade_Agent
GoTrade_Agent 运行在公司内网环境（与 HS 同机或同内网）
HS 的 Admin API 仅对本机/内网开放（localhost/内网网段），不对公网开放

#### 7.2.2 通讯模式

Agent 与 Hub 建立 WebSocket（优先）/长轮询（备选） 通道
Agent 持续监听来自 Hub 的管理指令：
CREATE_USER（创建员工）
DISABLE_USER（停用/禁用）
FORCE_RESET_PASSWORD（强制重置）
RESET_PASSWORD（发起重置流程/生成临时密码策略见 5.2）
SYNC_STATUS（回报执行结果）

#### 7.2.3 执行方式

Agent 收到指令后调用 本地 HS Admin API（localhost） 执行
Agent 将执行结果（成功/失败、错误码、耗时、关联 user_id）回传 Hub

#### 7.2.4 安全性与权限

HS Admin API 无需暴露公网
Hub 不持有 HS Admin API 的公网访问能力
Agent 与 Hub 连接需要：
AGENT_TOKEN（公司级别）
company_id 绑定校验
指令签名/重放防护（v1 可先用 request_id + 时效窗口）

#### 7.2.5 验收

在 Hub 后台新增/停用员工，最终能在公司 HS 生效（通过 Agent）
公司 HS Admin API 端口对公网不可达，但功能不受影响
Hub 可看到 Agent 在线/离线与最近心跳时间

---

## 8. 数据模型（Supabase）（v1）

### 8.1 表：companies

* id (uuid, pk)
* company_slug (text, unique, required)
* display_name (text)
* hs_domain (text, required)
* status (enum: active/suspended)
* translation_subscription_active (bool)
* translation_quota_limit (int, optional)
* created_at / updated_at

### 8.2 表：company_admins

* id (uuid, pk)
* company_id (fk companies.id)
* auth_user_id (text)  ← Supabase Auth user id
* role (enum: company_admin)
* created_at

### 8.3 表：company_settings（Company 端配置）

* company_id (fk)
* rag_api_endpoint (text)
* rag_api_key (text, encrypted/secret storage 优先；v1 可先 env+vault)
* updated_at
RLS：仅该公司管理员可读写；平台管理员可读。

### 8.4 表：agents（新增表，用于可观测）

* id (uuid pk)
* company_id
* agent_status (online/offline)
* last_seen_at
* agent_version
* created_at

### 8.5 表：profiles（所有用户档案：员工+客户）

* id (uuid, pk)
* auth_user_id (text, nullable)  ← 客户/公司管理员可用；员工可选
* company_id (fk companies.id, required)
* user_local_id (text, required)
* handle (text, unique, required)  ← `company_slug.user_local_id`
* matrix_user_id (text, required)  ← `@user_local_id:hs_domain`
* user_type (enum: client/staff/admin)
* status (enum: active/disabled)
* storage_quota_mb (int)
* created_at / updated_at
* password_state enum：ACTIVE | RESET_REQUIRED（仅 staff/admin 有意义）
* last_password_reset_at（可选）
* matrix_user_id 继续保留用于映射与搜索

**唯一性约束**

* handle 全平台唯一
* (company_id, user_local_id) 唯一

### 8.5 表：translation_usage_logs

* id (uuid, pk)
* company_id
* requester_profile_id
* model (text)
* target_lang (text)
* input_chars / output_chars（或 tokens）
* latency_ms
* status (success/failed)
* created_at

### 8.5 表：notebooks（可选 v1，或本地优先）

#### 8.5.1 Client（客户）

已使用 Supabase Auth → 笔记必须存 Supabase
新增 notebooks 表（见数据模型更新）
支持跨设备同步
* id (uuid pk)
* auth_user_id (text, required) ← Supabase Auth user id
* title (text)
* content (text)
* updated_at / created_at
* folder
* tags
RLS：仅本人可读写。

#### 8.5.2 Staff（公司员工）

隐私优先：继续存本地 SQLite（系统用户目录）
可选 v2：存公司服务器 PostgreSQL（不在 v1 做）

#### 8.5.3 PRD 明确差异

客户笔记：云端同步（Supabase）
员工笔记：本地持久化（SQLite），不上传 Hub

---

## 9. 桌面端（Element 二开）功能规格（v1）

### 9.1 启动入口

* 入口 1：客户（Client）

  * HS 固定：`matrix.gotradetalk.com`（UI 不显示可改）
  * 登录：Supabase Auth（邮箱/Google）→ Hub 创建 Matrix 账号 → 自动登录
* 入口 2：公司员工（Company）

  * HS 地址输入框：必填 `hs_domain`
  * 登录：走 Hub（员工凭据获取/重置由公司管理员后台控制）→ 登录公司 HS

### 9.2 搜索

* 输入 `company.user`（handle）
* 调 Hub 解析为 `matrix_user_id`
* 展示结果卡片：公司 display_name + user_local_id + 在线状态（如可取）

### 9.3 DM 流程

* “发起会话”按钮：创建 DM + invite
* 展示 pending 状态
* 对方接受后进入会话

### 9.4 翻译 UI

* 设置入口：设置 → 通用 → `Translation Target Language`
* 消息渲染：

  * 缓存：`{event_id: translatedText}`
  * 点击切换原文/译文（本地 state）
* 翻译请求：统一走 Edge Function

### 9.5 功能区（扩展点）

* v1：预留侧边栏入口，不实现外部插件协议细节

### 9.6首次登录强制改密（Force Password Reset）

你描述的交互可以直接进入 v1。

#### 9.6.1 触发条件

用户成功登录公司 HS
桌面端查询 Hub 用户档案状态为 RESET_REQUIRED
注意：这里的“Hub 返回状态”实现方式建议固定为：桌面端登录后调用 Hub GET /me（用员工的 Hub 身份或与 HS 绑定的映射方式）。如果 v1 暂不做员工的 Supabase Auth，则可用“HS 登录后上报给 Agent→Agent 回传 Hub→Hub 返回状态”这种简化链路（实现细节写入技术方案即可）。

#### 9.6.2 交互

全屏阻断弹窗，不可关闭
仅提供“新密码/确认密码/提交”
调用 Matrix 标准改密接口（由客户端对 HS 执行）

#### 9.6.3 成功回调

改密成功 → 回调 Hub 将 password_state 更新为 ACTIVE
解锁界面

#### 9.6.4 异常处理

改密失败（弱密码/策略不符/网络错误）：
保留在弹窗页
显示错误原因
允许重新输入

#### 验收

新员工首次登录必须改密，否则无法进入主界面
重置密码后再次触发强制改密

---

## 10. 非功能需求（NFR）

### 10.1 安全与隐私

* Hub 不存储聊天正文
* 翻译不落库正文，仅存用量
* Supabase RLS：公司管理员只能访问本公司数据；平台管理员可全局访问

### 10.2 可用性与性能（v1 目标值）

* 翻译请求 P95 < 3s（依赖模型与网络，作为目标值）
* 搜索解析 P95 < 500ms（Hub 内部查询）

### 10.3 数据持久化

* 公司端笔记 SQLite 存系统用户目录，应用升级不影响
* 附件存本地盘：按用户配额限制；超额禁传

---

## 11. 里程碑（v1 建议拆解）

1. Hub 数据库与权限（companies / profiles / admins / RLS）
2. 平台管理员后台（创建公司、公司管理员）
3. 公司管理后台（员工 CRUD + 同步按钮）
4. HS 同步机制落地（定 X/Y 之一）
5. 桌面端双入口与 handle 搜索解析
6. DM 邀请流程（pending/accepted）
7. 翻译 Edge Function + 前端 UI 切换 + 用量日志
8. 知识库入口（仅展示）
9. 记事本 SQLite 与附件配额

---

## 12. v1 验收清单（可直接用于测试）

* 平台管理员能创建公司（company_slug 唯一）与公司管理员
* 公司管理员能新增员工并同步到公司 HS
* 客户能通过 Supabase 注册并由 Hub 自动创建公共 HS 账号
* 任意用户能通过输入 `company.user` 找到人并发起 DM 邀请
* DM 必须对方接受后才能聊天（拒绝不进入房间）
* 翻译仅通过 Edge Function，未订阅公司翻译会被拒绝
* 翻译不落库正文，但能在后台看到用量日志
* 公司端笔记 SQLite 在系统用户目录，升级后仍存在
* 附件按用户配额，超额禁传

---

## 13. 待定项（必须在开发前锁定）

1. **HS 账号创建与同步方式：X（注册令牌/共享密钥）或 Y（Admin API）**
2. 公司员工“登录凭据发放/重置”流程细节（由公司管理员后台重置密码？还是生成一次性登录链接？）
3. Presence/在线状态是否需要聚合展示（Matrix 获取方式与隐私策略）


