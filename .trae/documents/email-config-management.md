# 邮件通知配置管理（前端界面 + 数据库存储）

## Context

当前邮件通知配置写死在 `.env`（SMTP_HOST/USER/PASS/NOTIFY_EMAIL），无法在界面管理。需求：前端新增"邮件通知"界面，对**发件 SMTP 账户**和**收件邮箱**做增删改查，数据库建两个表存储，发热点邮件时从数据库读取配置。

已与用户确认的决策：
- **收件邮箱**：多选启用，发邮件时发给所有 `isEnabled` 的收件人（一次 sendMail 多个 to）
- **发件账户**：单选激活（`isActive`），可存多个备用账户，同时只有一个生效
- **测试邮件**：需要，配置后可一键发测试邮件验证
- **env 兼容**：不保留，配置**完全以数据库为准**，`.env` 中邮件相关变量作废（相应清理 `.env.example` 与 email.ts 中的 env 读取）

## 数据库（Prisma + SQLite）

[server/prisma/schema.prisma](file:///Volumes/samsungt7/code/agent/monitor/server/prisma/schema.prisma) 新增两个 model：

```prisma
// 发件 SMTP 账户
model EmailAccount {
  id        String   @id @default(uuid())
  name      String            // 备注名，如 "QQ邮箱-工作"
  host      String            // smtp.qq.com
  port      Int      @default(587)
  secure    Boolean  @default(false)
  username  String            // SMTP 用户名（登录账号）
  password  String            // 密码/授权码
  isActive  Boolean  @default(false)  // 当前使用，全局仅一个（路由层保证）
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 收件邮箱
model EmailRecipient {
  id        String   @id @default(uuid())
  name      String?           // 备注名（可选）
  address   String   @unique  // 收件邮箱
  isEnabled Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

迁移：`cd server && npx prisma migrate dev --name add_email_config`（项目已有 migrations 目录，沿用此模式）。

"单选激活"不靠数据库约束，靠路由事务保证：激活某账户时先 `updateMany({ where: { isActive: true }, data: { isActive: false } })` 再激活目标。

## 后端

### 1. 新路由 `server/src/routes/email.ts`

参考 [keywords.ts](file:///Volumes/samsungt7/code/agent/monitor/server/src/routes/keywords.ts) 的 REST CRUD 写法（try/catch + P2002/P2025 错误处理 + 手动参数校验）：

- `GET /api/email/accounts` — 列表，**password 掩码**返回（复用 [settings.ts#L7-L21](file:///Volumes/samsungt7/code/agent/monitor/server/src/routes/settings.ts#L7-L21) 的 maskValue 思路）
- `POST /api/email/accounts` — 创建（校验 name/host/username/password 必填，port 数字）；若 body 带 `isActive: true`，走单选激活事务
- `PUT /api/email/accounts/:id` — 更新；**password 不传或为空时保留原密码**（前端掩码不回传）
- `DELETE /api/email/accounts/:id` — 删除（删除的是激活账户时无所谓，自然回落为"未配置"）
- `PATCH /api/email/accounts/:id/activate` — 单选激活（updateMany 置 false + update 目标）
- `GET /api/email/recipients` — 列表
- `POST /api/email/recipients` — 创建（校验 address 非空、简单邮箱格式；P2002 → 409 重复）
- `PUT /api/email/recipients/:id` — 更新（address/name/isEnabled）
- `PATCH /api/email/recipients/:id/toggle` — 切换启用状态
- `DELETE /api/email/recipients/:id` — 删除
- `POST /api/email/test` — 用激活账户向所有启用收件人发测试邮件，返回 `{ ok, sent, error }`

在 [index.ts#L31-L36](file:///Volumes/samsungt7/code/agent/monitor/server/src/index.ts#L31-L36) 挂载 `app.use('/api/email', emailRouter)`。

### 2. 重构 `server/src/services/email.ts`

- `getTransporter()` 改为 async：`prisma.emailAccount.findFirst({ where: { isActive: true } })`，查不到返回 null（**删除所有 process.env.SMTP_* / NOTIFY_EMAIL 读取**）
- transporter 缓存：缓存键改为 `account.id + account.updatedAt`，配置变更后自动重建（解决"改了配置还用旧连接"的问题）
- 新增 `getActiveRecipients()`: 查所有 `isEnabled: true` 的收件人，`to` 用逗号拼接地址
- `sendHotspotEmail(hotspot)`：无激活账户或无启用收件人 → 直接 `return false`（日志提示配置缺失）；HTML 模板保持不变
- `sendDigestEmail` 同步改造收件人来源
- 新增 `sendTestEmail()`：简单 HTML 文案"这是一封测试邮件"

[hotspotChecker.ts#L232-L235](file:///Volumes/samsungt7/code/agent/monitor/server/src/jobs/hotspotChecker.ts#L232-L235) 调用点无需改动。

### 3. 清理

- [server/.env.example#L19-L25](file:///Volumes/samsungt7/code/agent/monitor/server/.env.example#L19-L25)：删除邮件通知段落（配置已迁移到数据库）

## 前端

### 1. API 层 `client/src/services/api.ts`

新增类型（account 的 password 为掩码字符串）与 `emailApi`，复用现有 `request<T>` 封装（[api.ts#L60-L79](file:///Volumes/samsungt7/code/agent/monitor/client/src/services/api.ts#L60-L79)）：

- `emailApi.accounts.getAll/create/update/activate/remove`
- `emailApi.recipients.getAll/create/update/toggle/remove`
- `emailApi.sendTest()`

### 2. 新组件 `client/src/components/EmailConfigPanel.tsx`

结构上参考 [SettingsPanel.tsx](file:///Volumes/samsungt7/code/agent/monitor/client/src/components/SettingsPanel.tsx)（加载、onToast、卡片选中态、loading 按钮），props: `{ onToast }`。布局分两区：

**发件账户区**：
- 卡片列表：备注名、`host:port`、用户名、激活徽标；点击卡片激活（调 activate 接口，参考 SettingsPanel `handleSelectProvider` 的"选择即保存"模式）
- 每卡片：编辑 / 删除（删除带确认，参考 App.tsx 已有确认弹窗模式）按钮
- "新增账户"按钮 → 弹窗表单：name、host、port、secure(SSL 开关)、username、password（编辑时密码留空表示不改，参考 SettingsPanel 的密码输入 + Eye/EyeOff 显隐）
- "发送测试邮件"按钮（loading → 成功/失败 toast，参考 SettingsPanel handleTest）

**收件邮箱区**：
- 行/卡片列表：邮箱地址、备注、启用开关（toggle 接口）
- 新增/编辑弹窗（address、name）、删除确认

弹窗、表单样式沿用项目现有 Tailwind 风格（`bg-white/5`、`rounded-xl`、`border-white/10` 一类）。

### 3. 接入 `client/src/App.tsx`

- import `Mail` 图标 + `EmailConfigPanel`
- [App.tsx#L451-L455](file:///Volumes/samsungt7/code/agent/monitor/client/src/App.tsx#L451-L455) tabs 数组加 `{ key: 'email', label: '邮件通知', icon: Mail }`
- `activeTab` 类型联合加上 `'email'`（[App.tsx#L62](file:///Volumes/samsungt7/code/agent/monitor/client/src/App.tsx#L62)）
- Tab 内容区（`settings` 分支旁，[App.tsx#L1195-L1198](file:///Volumes/samsungt7/code/agent/monitor/client/src/App.tsx#L1195-L1198)）加 `{activeTab === 'email' && <EmailConfigPanel onToast={showToast} />}`

## 实施顺序

1. schema.prisma 加两个 model → `prisma migrate dev` 生成迁移
2. 重构 email.ts（服务层先行，路由依赖它）
3. 新建 routes/email.ts + index.ts 挂载
4. api.ts 加类型与 emailApi
5. 新建 EmailConfigPanel.tsx
6. App.tsx 接入新 tab
7. 清理 .env.example 邮件段落
8. 端到端验证

## 验证

1. `cd server && npx prisma migrate dev --name add_email_config` 迁移成功
2. `cd server && npm run dev` 启动后端，curl 验证 REST：
   - `curl localhost:3001/api/email/accounts` 返回 `[]`
   - POST 创建账户/收件人 → GET 列表显示掩码密码 → PATCH activate → 再次 GET 确认单激活
   - `POST /api/email/test` 无配置时返回明确错误，配置真实 SMTP（如 QQ 邮箱授权码）后收件箱收到测试邮件
3. `cd client && npm run dev` 启动前端，浏览器操作：
   - 新 tab"邮件通知"出现
   - 新增/编辑/删除账户和收件人、切换激活、切换启用均正常且 toast 反馈
   - 编辑账户时密码留空保存后原密码未被清空（再点测试邮件仍能发出）
4. 无邮箱配置时 `POST /api/check-hotspots`，日志应显示邮件跳过而非报错

## 不做的事

- 不改 `sendHotspotEmail` 的触发条件（仍只对 high/urgent 发单条邮件）
- 不启用 `sendDigestEmail` 的定时调度（保持预留）
- 不做多发件账户故障切换
