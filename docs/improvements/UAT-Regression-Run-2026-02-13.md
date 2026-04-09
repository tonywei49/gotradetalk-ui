# UAT / 回归执行结果（2026-02-13）

## 执行环境
- UI: `https://chat.gotradetalk.com`
- 登录模式: `staff`
- 账号: `test.john`（`hululucky`）
- 自动化工具: Playwright

## 本轮覆盖范围
1. Toast/错误提示可见性（登录失败）
2. 上传草稿一致性（切房间 / 刷新）
3. 基线流程（登录 + 附件上传发送撤回）

## 结果总览
- PASS: 3
- FAIL: 1
- BLOCKED: 0

---

## 1) 基线流程
### 用例
- `upload -> send -> delete file message smoke`
- `auth smoke`

### 结果
- PASS

### 备注
- 通过命令（staff）：
  - `E2E_LOGIN_MODE=staff E2E_STAFF_COMPANY_SLUG=hululucky E2E_STAFF_TLD=com E2E_STAFF_USERNAME=test.john E2E_STAFF_PASSWORD=*** PLAYWRIGHT_BASE_URL=https://chat.gotradetalk.com npm run test:e2e`

---

## 2) Toast/错误提示可见性
### 用例
- Client 错账密登录
- Staff 错账密登录

### 结果
- PASS

### 观察
- Client 错误提示：`Account not found`
- Staff 错误提示：`MatrixError: [403] M_FORBIDDEN: Wrong username or password...`

### 风险
- 文案来源仍分散（Hub/Matrix 原文直出），尚未统一成产品级提示规范。

---

## 3) 上传草稿一致性（断点场景子集）
### 用例 A
- 上传文件到“待发送”状态
- 切换到其他房间再切回

### 结果 A
- PASS（草稿仍可见）

### 用例 B
- 上传文件到“待发送”状态
- 直接刷新页面

### 结果 B
- FAIL（草稿消失）

### 复现结论
- 当前行为：`切房间`可保留，`刷新`后丢失未发送草稿。
- 影响：用户会产生“文件不见了/是否已上传成功”的不确定感。

---

## 尚未执行（下一轮）
1. 配额超限提示（`M_LIMIT_EXCEEDED`）统一验证
2. 网络超时/断网重连队列恢复
3. 文件中心大数据量性能（分页/虚拟列表/去抖）
4. Nginx 镜像化部署与 UAT 全签核
5. UI vs Element 全链路一致性比对

