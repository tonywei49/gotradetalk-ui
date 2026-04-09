【交付给 Cursor 的任务描述 #1：Hub（Supabase）后端与后台落地清单】

目标
- Hub 作为权威源：公司、管理员、员工、客户档案、订阅状态、翻译用量、RAG 配置、Agent 在线状态
- Hub 不存聊天内容；翻译不存正文，仅存用量日志
- 公司 HS 的账号管理动作不由 Hub 直连公网 Admin API，而是通过 GoTrade_Agent 执行（见交付 #2）

技术边界
- 数据层：Supabase Postgres
- 鉴权：Supabase Auth（平台管理员、公司管理员、客户必须使用）
- 员工（staff）不要求 Supabase Auth 登录（v1 简化），但需要“强制改密状态查询/回写”的闭环（通过 Agent 证明）

一、数据库表（DDL 级别任务）
1) companies
- id uuid pk
- company_slug text unique not null
- display_name text
- hs_domain text not null
- status enum(active,suspended) default active
- translation_subscription_active boolean default false
- translation_quota_limit integer null
- created_at/updated_at

2) platform_admins
- id uuid pk
- auth_user_id text unique not null (Supabase Auth user id)
- role enum(platform_admin) default platform_admin
- created_at

3) company_admins
- id uuid pk
- company_id fk companies.id not null
- auth_user_id text unique not null
- role enum(company_admin) default company_admin
- created_at

4) profiles（统一用户档案：client/staff）
- id uuid pk
- company_id fk companies.id not null
- user_type enum(client,staff) not null
- auth_user_id text null（client 必填；staff 可空；后续可拓展 staff 也走 Auth）
- user_local_id text not null
- handle text unique not null（格式：company_slug.user_local_id）
- matrix_user_id text not null（格式：@user_local_id:hs_domain）
- status enum(active,disabled) default active
- password_state enum(ACTIVE,RESET_REQUIRED) default RESET_REQUIRED（仅 staff 有意义；client 可置 ACTIVE）
- storage_quota_mb integer default 500（示例）
- created_at/updated_at
唯一性约束：
- unique(company_id, user_local_id)
- unique(handle)

5) company_settings（公司级配置）
- company_id pk fk companies.id
- rag_api_endpoint text null
- rag_api_key text null（v1 可先明文存 + RLS；更推荐后续迁移 vault/secret）
- updated_at

6) agents（公司 Agent 在线与版本）
- id uuid pk
- company_id fk companies.id not null
- agent_instance_id text not null（每次部署生成）
- status enum(online,offline) default offline
- last_seen_at timestamptz
- agent_version text
- created_at/updated_at
唯一性：
- unique(company_id, agent_instance_id)

7) translation_usage_logs
- id uuid pk
- company_id fk
- requester_profile_id fk profiles.id
- model text
- target_lang text
- input_chars int
- output_chars int
- latency_ms int
- status enum(success,failed)
- created_at timestamptz default now()

8) notebooks（仅 client 云端同步）
- id uuid pk
- auth_user_id text not null
- title text
- content text
- updated_at/created_at

二、RLS（Row Level Security）规则（必须落地）
1) companies
- platform_admin：可读写全部
- company_admin：只读本公司 + 只允许更新本公司的 “非敏感字段”（例如 display_name；订阅字段不可改）
- staff/client：不可直接访问（或只读本公司 display_name，视 UI 需要）

2) profiles
- platform_admin：可读写全部
- company_admin：可读写本公司 profiles（新增/停用/重置状态/配额）
- client：只能读写自己的 profile（通过 auth_user_id）
- staff：v1 不直接开放 profiles 的读写（避免 staff 没 Auth 时绕过）；staff 相关状态查询走“Agent 证明接口”（见 API）

3) company_settings
- platform_admin：可读
- company_admin：可读写本公司
- 其他：不可访问

4) agents
- platform_admin：可读
- company_admin：可读本公司
- 写入（online/offline/last_seen）：仅允许通过“Agent 服务密钥验证的 Edge Function”写（不开放普通 RLS 写）

5) notebooks
- 仅本人（auth_user_id）可读写

三、Edge Functions / Hub API（按用途拆分）
A) 平台管理员（Platform Admin）
1) POST /admin/companies
- 输入：company_slug, display_name, hs_domain
- 行为：创建 companies 记录 + 初始化 company_settings（空） + 返回 company_id
- 权限：platform_admin

2) POST /admin/companies/{company_id}/company-admin
- 输入：email/或 auth_user_id（以 Supabase Auth 为准）
- 行为：绑定 company_admins
- 权限：platform_admin

B) 公司管理员（Company Admin）
3) POST /company/staff
- 输入：user_local_id,（可选）备注/邮箱, storage_quota_mb
- 行为：
  - 创建 profiles（user_type=staff, status=active, password_state=RESET_REQUIRED）
  - 自动生成 handle=company_slug.user_local_id
  - 生成 matrix_user_id=@user_local_id:hs_domain
  - 下发“创建用户”指令给 Agent（异步/入队），并返回创建结果（pending）
- 权限：company_admin

4) POST /company/staff/{profile_id}/disable
- 行为：profiles.status=disabled + 下发禁用指令给 Agent
- 权限：company_admin

5) POST /company/staff/{profile_id}/force-reset
- 行为：profiles.password_state=RESET_REQUIRED + 下发强制重置指令给 Agent（重置策略由 Agent/HS 执行）
- 权限：company_admin

6) PUT /company/settings/rag
- 输入：rag_api_endpoint, rag_api_key
- 行为：更新 company_settings
- 权限：company_admin

C) 客户（Client）
7) POST /client/signup-provision
- 输入：Supabase Auth 已登录（email/google），以及期望 user_local_id（可为空则自动生成）
- 行为：
  - 在 profiles 创建 client 档案（company_slug 固定 gotradetalk；hs_domain=matrix.gotradetalk.com）
  - 调用公共 HS 的“创建账号”执行链（通过公共 HS Agent 或 Hub 直连公共 HS，二选一；v1 可先 Hub 直连公共 HS localhost 不存在，因此建议也用公共 HS 的 Agent）
  - 返回：matrix_user_id + 登录所需材料（如果客户端需要自动登录）
- 权限：client（auth 必须存在）

D) 翻译（所有翻译统一走 Hub）
8) POST /translate
- 输入：text, target_lang, requester_context（可选：source_lang_hint）
- 鉴权与计费主体：
  - 识别 requester 属于哪个公司：如果 requester 是 client，也要能映射到“对话所属公司”并按公司计费（v1 简化：由发起翻译的一端发起请求；公司端翻译请求来自 company staff；client 端对公司消息的翻译请求也要带上“对话公司 company_id”由 Hub 校验订阅）
- 行为：检查 companies.translation_subscription_active；通过则调用 DeepSeek；写 translation_usage_logs（不写正文）；返回译文
- 失败：明确错误码（NOT_SUBSCRIBED / QUOTA_EXCEEDED / MODEL_ERROR）

E) 员工强制改密闭环（核心：staff 不走 Supabase Auth）
9) GET /staff/password-state
- 输入：matrix_user_id + agent_assertion（见交付#2，Agent 证明该用户已在本公司 HS 登录）
- 输出：password_state
- 权限：由 agent_assertion 决定（不依赖 Supabase Auth）

10) POST /staff/password-state/activate
- 输入：matrix_user_id + agent_assertion + new_state=ACTIVE
- 行为：将对应 staff profile.password_state 更新为 ACTIVE
- 权限：同上

F) Agent 在线与指令队列（v1 两种实现，任选其一）
实现方式 1（更简单）：Hub 维护 commands 表 + Agent 轮询/WS 拉取
- 新增表：agent_commands（company_id, command_type, payload_json, status, created_at）
- Edge：Agent 拉取 pending 命令，执行后回写 status 与结果

实现方式 2（更实时）：Hub 提供 WS Gateway（Node 服务）转发指令
- Supabase 只存状态与审计；指令走 WS 服务

四、后台 UI（页面级任务）
1) Platform Admin Console
- 登录（Supabase Auth，仅 platform_admin 允许进入）
- 公司列表/创建公司/编辑 hs_domain
- 创建公司管理员账号
- 查看 Agent 在线（按 company）
- 查看翻译用量（按 company 汇总）

2) Company Admin Console
- 登录（Supabase Auth，仅 company_admin）
- 员工列表：新增/停用/强制重置/配额编辑
- Agent 状态：在线/离线/最后心跳；离线时操作提示 pending
- RAG 配置：endpoint/key 表单
- 用量日志（本公司）

五、验收（最小可用闭环）
- 平台管理员创建公司 + 创建公司管理员
- 公司管理员新增员工 → Hub 产生记录 → Agent 执行创建 → staff 可登录 HS
- staff 首登：被强制改密 → 改密成功 → Hub 状态从 RESET_REQUIRED→ACTIVE
- 客户注册：Supabase Auth + 公共 HS 账号创建成功
- 翻译：仅订阅公司可用，日志可查，不存正文
- RAG：后台配置后，桌面端通过 Agent 转发能拿到检索结果
