【任务描述 #2：GoTrade_Agent 与桌面端交互协议（指令/鉴权/改密/RAG）】

目标
- 公司端内网常驻 GoTrade_Agent，避免暴露公司 HS Admin API 到公网
- Hub 下发管理指令：创建/停用/重置
- Agent 负责：
  1) 调用 localhost 的 HS Admin API 执行账号管理
  2) 为“员工强制改密闭环”提供“已登录证明”（agent_assertion）
  3) 作为公司内网网关：转发 RAG 请求到 Bisheng/RAGFlow

一、部署与运行环境
- Agent 与 Continuwuity（公司 HS）同机或同内网
- Agent 可访问 HS Admin API：localhost 或内网地址
- Agent 对桌面端提供本地接口（推荐仅内网可访问）
  - HTTP：http://agent.lan:PORT（或 localhost:PORT 如果桌面端与 Agent 同机）
  - 端口由部署包固定或可配置

二、Agent <-> Hub 通讯（推荐 WebSocket；备选长轮询）
1) 连接参数
- company_id（Agent 绑定公司）
- agent_instance_id（随机生成，唯一标识本次部署）
- agent_token（公司级密钥，由平台管理员在创建公司后生成/展示一次，写入公司部署包环境变量）

2) 心跳
- 每 10-30 秒发送 HEARTBEAT
- payload：agent_version、capabilities（account_admin, rag_proxy）、hs_domain、last_error

3) 在线状态回写
- Hub 接收心跳 → 更新 agents.status=online、last_seen_at=now()
- 若超过 2 个心跳周期未收到 → Hub 标记 offline（由后台任务执行）

三、指令协议（Hub -> Agent）
统一 envelope（JSON）：
- type: "COMMAND"
- request_id: uuid（全局唯一，用于幂等与重试）
- company_id
- command: enum
- issued_at: ISO 时间
- payload: object
- signature:（v1 可选）HMAC(agent_token, request_id+payload_hash)

命令集合（v1）：
1) CREATE_USER
payload:
- user_local_id
- matrix_user_id（@user:hs_domain）
- initial_password_mode: "ADMIN_PROVIDED" | "ONE_TIME"
- initial_password_value: string（仅当 ADMIN_PROVIDED 或 ONE_TIME；Agent 不回传此值）
- force_password_reset: true（默认 true）

Agent 执行：
- 调用 HS Admin API 在本地创建用户
- 设置初始密码（若 HS 支持）
- 标记该用户需要改密（若 HS 支持策略；否则由桌面端 9.6 强制弹窗实现）
- 回报结果

2) DISABLE_USER
payload:
- matrix_user_id
- reason（可选）
Agent：调用 HS Admin API 禁用/锁定用户

3) FORCE_RESET_PASSWORD
payload:
- matrix_user_id
- reset_mode: "ADMIN_PROVIDED" | "ONE_TIME" | "INVALIDATE_ONLY"
- temp_password（可选）
Agent：执行重置或令牌失效（取决于 HS 能力）；回报结果

4) SYNC_STATUS（可选）
payload:
- matrix_user_id list
Agent：对账 HS 中该用户是否存在/状态是否一致

四、回执协议（Agent -> Hub）
envelope:
- type: "RESULT"
- request_id
- company_id
- success: boolean
- result_code: enum(OK, USER_EXISTS, USER_NOT_FOUND, HS_ERROR, AUTH_ERROR, VALIDATION_ERROR)
- message: string（可读）
- details: object（错误码/HS 返回码/耗时）
- reported_at

幂等策略
- Agent 需记录最近 N 条 request_id（本地轻量存储）避免重复执行
- 对 CREATE_USER：若用户已存在则返回 USER_EXISTS（success=true 或 false 按你偏好，但需一致）

五、桌面端 <-> Agent（内网接口）
A) RAG 转发（桌面端不直连外部）
- POST /rag/search
request:
- query: string
- top_k: int（可选）
- filters: object（可选）
response:
- items: [{title, snippet, score, source_url, metadata}]
- raw: object（可选）

Agent 行为：
- 从 Hub 拉取 company_settings.rag_api_endpoint / rag_api_key（启动时拉取 + 定期刷新/或 Hub 推送）
- 转发到 Bisheng/RAGFlow
- 返回标准化结果给桌面端

B) 登录证明（用于强制改密闭环：Hub 不验证 HS token）
问题：staff 不用 Supabase Auth，Hub 需要确认“这个 matrix_user_id 的确已在该公司 HS 登录”
解决：Agent 本地验证 HS access_token，然后给 Hub 出具 agent_assertion。

接口：
- POST /auth/assert
request:
- hs_domain
- access_token（用户登录 HS 后拿到的 token）
response:
- agent_assertion: string（短时效 JWT 或 HMAC 签名票据）
- matrix_user_id
- expires_at

Agent 验证步骤：
1) 调 HS Client API /whoami（本地可达）验证 access_token
2) 得到 matrix_user_id
3) 生成 agent_assertion（建议 JWT）：
   - iss=agent_instance_id
   - aud=hub
   - sub=matrix_user_id
   - company_id
   - exp=now()+60s（短时效）
   - jti=request_id
   - 签名密钥=agent_token（或 agent 私钥）

桌面端使用：
- 登录 HS 成功后，调用 Agent /auth/assert 拿 assertion
- 再调用 Hub：
  - GET /staff/password-state?matrix_user_id=...（带 assertion）
  - 若返回 RESET_REQUIRED → 进入 9.6 强制改密
  - 改密成功后 → 再调用 Agent /auth/assert（重新拿 assertion）→ POST /staff/password-state/activate（带 assertion）

六、桌面端 9.6 强制改密（Force Password Reset）
触发流程（对 staff）：
1) staff 登录 HS 成功（拿到 access_token）
2) 桌面端向 Agent /auth/assert 获取 agent_assertion
3) 桌面端调用 Hub /staff/password-state（带 assertion）
4) 若 RESET_REQUIRED：
   - 全屏阻断弹窗（不可关闭）
   - 调用 Matrix 标准改密接口（对 HS 执行）
   - 改密成功：再次获取 assertion → 调 Hub /staff/password-state/activate → 解锁 UI
5) 若 ACTIVE：正常进入主界面

失败处理：
- 改密接口返回策略错误 → 弹窗提示并停留
- Hub 回写失败 → 允许重试“回写 ACTIVE”

七、安全基线（v1 最小要求）
- Agent_token 必须公司级别独立（不建议全平台同一个）
- Agent_assertion 短时效（<=60s）+ jti 防重放
- Agent 与 Hub 通讯建议全程 TLS（wss/https）
- HS Admin API 不对公网开放（必须验收）

八、可观测（v1）
- Agent 本地日志：命令执行、HS API 返回、RAG 代理请求耗时
- Hub 日志：命令下发、回执、失败重试次数、Agent 在线状态历史
