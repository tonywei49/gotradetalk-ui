# Translation Rules v1

## 核心原则
1. 只翻译“我收到的文本消息”。
2. 收到语种与目标语种一致时不翻译。
3. client ↔ client 不翻译。
4. staff ↔ staff 同公司不翻译。
5. staff ↔ staff 不同公司翻译收到的消息。
6. client ↔ staff 双向翻译收到的消息。
7. 目标语种为空不翻译。
8. 统一走 Hub 做权限、配额与日志校验。

## 私聊规则
- client ↔ client: 不翻译
- client ↔ staff: 双向翻译“收到的消息”
- staff ↔ staff 同公司: 不翻译
- staff ↔ staff 不同公司: 仅翻译“收到的消息”

## 群聊规则
- client 发言:
  - staff 收到可翻译
  - client 收到不翻译
- staff 发言:
  - client 收到可翻译
  - 不同公司 staff 收到可翻译
  - 同公司 staff 不翻译

## UI 规则
- 有译文: 默认显示译文, 可切换原文
- 无译文: 默认显示原文
- 点译文按钮:
  - pending: 显示“翻译中”
  - failed: 显示“译文不可用”

## 例外与降级
- NOT_SUBSCRIBED/CLIENT_TRANSLATION_DISABLED/QUOTA_EXCEEDED -> 不翻译, 显示原文
- 同语种识别命中 -> 直接返回原文, 不调用 LLM
