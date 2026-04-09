# Translation Implementation Checklist v1

## 后端（Hub）
1. 公司级翻译配置
   - [x] 新增 company_settings: translation_base_url, translation_api_key, translation_model, translation_prompt
   - [x] 管理端/公司端配置读写接口
   - [x] 配置隔离（company_id 维度）

2. 翻译执行
   - [x] /translate 根据 company_id 读取配置并调用
   - [x] 同语种短路（source_lang_hint / 语言检测）
   - [x] 幂等与缓存（room_id + message_id + target_lang + source_hash）
   - [x] 日志按公司归集

3. 权限与规则兜底
   - [x] client/client 禁止
   - [x] staff/staff 同公司禁止
   - [x] staff/staff 不同公司允许
   - [x] client/staff 允许
   - [x] 目标语种为空禁止

## 前端（UI）
1. 私聊判定
   - [x] ROOM_KIND_EVENT > m.direct > member-count fallback

2. 翻译触发
   - [x] 只翻译“收到的消息”
   - [x] client ↔ staff 双向翻译
   - [x] staff ↔ staff 不同公司仅翻译收到的消息
   - [x] 同公司 staff 不翻译
   - [x] client ↔ client 不翻译
   - [x] 目标语种为空不翻译

3. 发送预热（staff -> client）
   - [x] 发送原文
   - [x] 后台异步预热翻译
   - [x] 不阻塞发送

4. UI 展示
   - [x] 有译文: 默认译文, 可切原文
   - [x] 无译文: 默认原文
   - [x] pending/failed 状态提示

## 管理端（公司后台）
1. 翻译设置
   - [x] base_url / api_key / model / prompt
   - [x] 是否启用（默认开）

2. 用量统计
   - [x] 月度统计、角色/公司维度

## 测试
1. [x] 自动回归: npm run test:translation-regression
2. [x] 同语种跳过
3. [ ] 长文/短文时序
4. [ ] 群聊行为
