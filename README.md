# HotPulse · AI 热点监控工具

> 输入关键词，让 AI 从全网 8+ 信息源自动抓取、甄别、分析热点，并通过 WebSocket 实时推送到浏览器、通过邮件提醒重要情报。

一个前后端分离的 AI 实战项目：后端基于 Express 5 + Prisma，前端基于 React 19 + Vite，借助 OpenRouter 接入大模型完成真假识别与相关性分析，并把整套监控能力封装为可复用的 Agent Skills 技能包。

> 项目原作：[程序员鱼皮 · AI 热点监控工具](https://www.codefather.cn/)，本 README 聚焦功能模块与系统架构的工程说明。

---

## 目录

- [一、项目简介](#一项目简介)
- [二、六大功能模块](#二六大功能模块)
- [三、系统架构](#三系统架构)
- [四、项目结构](#四项目结构)
- [五、快速开始](#五快速开始)
- [六、API 接口速览](#六api-接口速览)
- [七、Agent Skills 技能包](#七agent-skills-技能包)
- [八、相关文档](#八相关文档)

---

## 一、项目简介

作为内容创作者或技术人，需要第一时间掌握领域动态（如大模型更新）。手动刷遍各平台既慢又容易漏。本项目把这件事交给 AI：

1. 你配置一批**监控关键词**；
2. 系统定时从 **Twitter、Bing、HackerNews、搜狗、Bilibili、微博** 等信息源并行抓取内容；
3. AI 自动完成**查询扩展 → 真假识别 → 相关性打分 → 重要性分级 → 摘要生成**；
4. 过滤掉低质、无关内容后入库，并通过 **实时推送 + 邮件 + 站内通知** 三通道告知你；
5. 同一套能力还能以 **Agent Skills** 形式被 Cursor / Claude Code 等 AI 工具直接调用。

---

## 二、六大功能模块

### 🗝️ 1. 关键词管理
| 能力 | 说明 |
|------|------|
| 添加 / 删除监控关键词 | 关键词唯一，重复添加返回冲突提示 |
| 激活 / 暂停单个关键词 | 一键切换状态，仅激活词参与定时巡检 |
| ⭐ AI 自动扩展查询变体 | Query Expansion：生成别名、缩写、中英对照等 5–15 个变体并缓存，用于文本预匹配 |
| B 站账号智能检测 | 关键词命中 UP 主时，直接抓取该账号最新投稿 |

### 🔍 2. 热点采集与分析
| 能力 | 说明 |
|------|------|
| ⭐ 8+ 数据源并行采集 | `Promise.allSettled` 并发抓取，单源失败不影响整体；内置频率限制与随机 UA |
| ⭐ AI 真实性验证 | 过滤标题党、假新闻、营销软文（`isReal`） |
| ⭐ AI 相关性评分（0–100） | 结合关键词变体预匹配严格打分，低于 50 分过滤 |
| AI 重要性分级 | `low / medium / high / urgent` 四档 |
| AI 智能摘要生成 | 一句话说明内容与监控关键词的关联 |
| AI 相关性分析理由 | 给出打分依据，前端可展开查看 |

### 📊 3. 信息展示与筛选
| 能力 | 说明 |
|------|------|
| 热点雷达仪表盘 | 总热点 / 今日新增 / 紧急热点 / 生效监控词四张统计卡 |
| ⭐ 5 种排序方式 | 最新、发布时间、相关性、重要性、热度（加权综合分） |
| ⭐ 多维度筛选 | 按来源、重要性、关键词、真实性、时间范围筛选 |
| 分页加载 | 服务端分页，参数回传前端 |
| 展开 / 折叠分析详情 | AI 理由与原始内容均可单独或一键展开 |
| 一键跳转原文 | 直达信息源 |

### 🔔 4. 通知系统
| 能力 | 说明 |
|------|------|
| ⭐ WebSocket 实时推送 | 基于房间（`keyword:<词>`）按关键词定向推送新热点 |
| 邮件通知（high/urgent） | 通过 Nodemailer/SMTP，仅重要级别触发，附 HTML 模板 |
| 站内通知管理 | 通知列表、单条已读、全部已读、删除 / 清空 |
| 已读 / 未读状态 | 未读计数实时联动顶部铃铛 |

### 🌐 5. 全网搜索
| 能力 | 说明 |
|------|------|
| 关键词全网搜索 | 手动输入关键词即时检索，不写入数据库 |
| 多数据源聚合结果 | 聚合搜索源并去重 |
| 搜索结果筛选排序 | 复用与仪表盘相同的筛选 / 排序组件（前端内存计算） |

### 🤖 6. Agent Skills
| 能力 | 说明 |
|------|------|
| ⭐ 完全自包含技能包 | `skills/hot-monitor`，无需后端与数据库即可独立运行 |
| ⭐ 多 AI 工具兼容 | 标准 `SKILL.md` 规范，可供 Cursor / VSCode Copilot / Claude Code 等加载 |
| Python 采集脚本 | 多源搜索脚本输出 JSON，供 Agent 自行分析 |
| 分析框架文档 | 提供真实性 / 相关性 / 重要性判定指南与报告模板 |

---

## 三、系统架构

### 3.1 整体分层

```
┌─────────────────────────────────────────────────────────────┐
│  浏览器  React 19 SPA（HotPulse）                             │
│  • 热点雷达 / 监控词 / 全网搜索 三个视图                        │
│  • Tailwind CSS + Framer Motion + Aceternity 风格组件          │
│  • api.ts（REST） · socket.ts（WebSocket）                    │
└───────────────┬─────────────────────────┬─────────────────────┘
                │ HTTP /api               │ WS /socket.io
                ▼                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Vite Dev Server（:5173）  —— proxy 代理到 :3001              │
└───────────────┬─────────────────────────┬─────────────────────┘
                │                         │
                ▼                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Express 5 服务（:3001）                                      │
│  Routes: /keywords  /hotspots  /notifications  /settings      │
│  • /api/health 健康检查   • /api/check-hotspots 手动触发       │
│  • Socket.io 房间订阅 / 事件推送                              │
│  • node-cron 每 30 分钟定时巡检                               │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  Services 业务层                                              │
│  jobs/hotspotChecker（巡检编排）                              │
│  services/: twitter · search · chinaSearch · ai · email       │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  Prisma ORM  →  SQLite（file:./dev.db）                       │
│  Keyword · Hotspot · Notification · Setting                  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 核心采集流水线

定时（每 30 分钟）或手动触发 `runHotspotCheck`，对每个激活关键词依次执行：

```
读取激活关键词
      │
      ├─① B 站账号检测 ──→ 命中则抓取该 UP 主最新投稿
      │
      ├─② Query Expansion ──→ AI 扩展关键词变体（带缓存）
      │
      ├─③ 多源并行采集 ──→ Twitter / Bing / HackerNews / 搜狗 / B站 / 微博
      │                     （Promise.allSettled，容错）
      │
      ├─④ 数据清洗 ──→ URL 去重 → 7 天新鲜度过滤 → 来源优先级排序
      │
      ├─⑤ 配额分配 ──→ Twitter 最多 15 条，其他源共 10 条
      │
      ├─⑥ AI 分析 ──→ 真假识别 + 相关性评分/理由 + 重要性 + 摘要
      │
      ├─⑦ 阈值过滤 ──→ 非真实 / 相关性<50 / 未提及且<65 一律丢弃
      │
      └─⑧ 入库 & 通知 ──→ 写 Hotspot + 站内 Notification
                            → WebSocket 按词推送 → high/urgent 发邮件
```

### 3.3 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React 19 + Vite 7 + TypeScript 5.9 | SPA，Vite 代理 REST 与 WebSocket |
| UI | Tailwind CSS 4 + Framer Motion + Lucide | 深色科技风，Aceternity 风格背景组件 |
| 后端 | Express 5 + TypeScript（tsx） | REST API + Socket.io 服务 |
| AI | OpenRouter SDK（DeepSeek V3.2） | 查询扩展、内容分析；未配置时有降级逻辑 |
| 采集 | axios + cheerio + twitterapi.io | 搜索引擎页面解析 + 平台公开 API |
| 定时任务 | node-cron | 每 30 分钟巡检 |
| 数据库 | SQLite + Prisma 6 | 4 张表，轻量本地存储 |
| 实时通信 | Socket.io 4 | 按关键词房间推送新热点 |
| 邮件 | Nodemailer | high/urgent 热点 HTML 邮件 |
| 测试 | Vitest | AI 相关性与热点排序单测 |
| 技能包 | Python（requests + beautifulsoup4） | 自包含 Agent Skills 采集脚本 |

### 3.4 数据模型

```
Keyword  1 ──── * Hotspot        （关键词 → 热点，删除关键词时外键置空）
Hotspot  1 ──── 0..1 Notification（热点 → 站内通知）
Setting  独立键值表              （系统配置）
```

- **Keyword**：`text`(唯一)、`category`、`isActive`
- **Hotspot**：标题、内容、URL、来源、真假、相关性、分析理由、重要性、摘要、互动/作者指标、关联关键词
- **Notification**：`type`、标题、内容、`isRead`、关联热点
- **Setting**：`key` / `value` 通用配置

### 3.5 数据源

| 来源 | 接入方式 | 备注 |
|------|----------|------|
| Twitter / X | twitterapi.io（需 Key） | Top 2 页 + Latest 1 页，本地质量过滤 |
| Bing / Google / DuckDuckGo | 页面抓取 + cheerio | 随机 UA + 频率限制 |
| HackerNews | Algolia 官方 API | 近 24h story |
| 搜狗 | 页面抓取 | 替代百度，反爬较宽松 |
| Bilibili | 公开 Web API | 视频搜索、用户搜索、账号投稿 |
| 微博 | 热搜公开 API | 关键词匹配热搜话题 |

> 默认巡检并行调用 Twitter / Bing / HackerNews / 搜狗 / Bilibili / 微博 六个源；Google、DuckDuckGo 的采集实现已内置于 `services/search.ts`。

---

## 四、项目结构

```
monitor/
├── client/                         # 前端：React 19 + Vite
│   └── src/
│       ├── components/             # FilterSortBar 等通用组件
│       │   └── ui/                 # 背景光束 / 流星 / 聚光灯等装饰组件
│       ├── services/               # api.ts（REST） · socket.ts（WebSocket）
│       ├── utils/                  # 排序、相对时间
│       ├── App.tsx                 # 主应用（三个视图）
│       └── main.tsx / index.css
├── server/                         # 后端：Express 5 + Prisma
│   ├── src/
│   │   ├── routes/                 # keywords / hotspots / notifications / settings
│   │   ├── services/               # ai / search / chinaSearch / twitter / email
│   │   ├── jobs/hotspotChecker.ts  # 核心巡检编排
│   │   ├── utils/sortHotspots.ts   # 重要性 / 热度内存排序
│   │   ├── types.ts / db.ts / index.ts
│   │   └── __tests__/              # Vitest 单测
│   └── prisma/                     # schema + migrations
├── skills/hot-monitor/             # Agent Skills 技能包
│   ├── SKILL.md                    # 技能描述与工作流
│   ├── references/                 # 数据源说明 / 分析指南
│   └── scripts/                    # Python 采集与报告脚本
├── docs/                           # 本地运行 / API / 需求文档
└── README.md
```

---

## 五、快速开始

### 前置条件

- Node.js ≥ 18（推荐 20 LTS）
- 一个 [OpenRouter API Key](https://openrouter.ai/settings/keys)（必需，用于 AI 分析）

### 1. 安装依赖

```bash
# 后端
cd server && npm install && npx prisma generate && npx prisma db push

# 前端
cd ../client && npm install
```

### 2. 配置环境变量

```bash
cp server/.env.example server/.env
```

编辑 `server/.env`，至少填入 OpenRouter Key：

```env
DATABASE_URL="file:./dev.db"
PORT=3001
CLIENT_URL=http://localhost:5173
OPENROUTER_API_KEY=sk-or-v1-你的key
# 可选：Twitter 采集
TWITTER_API_KEY=你的key
# 可选：邮件通知（high/urgent）
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=你的邮箱
SMTP_PASS=邮箱授权码
NOTIFY_EMAIL=接收邮箱
```

### 3. 启动服务（两个终端）

```bash
# 终端 1：后端（:3001）
cd server && npm run dev

# 终端 2：前端（:5173）
cd client && npm run dev
```

访问 **http://localhost:5173** 即可开始监控。

| 服务 | 地址 |
|------|------|
| 前端页面 | http://localhost:5173 |
| 后端 API | http://localhost:3001 |
| 健康检查 | http://localhost:3001/api/health |
| 数据库管理 | `cd server && npx prisma studio` |

> 详细排错与保姆级步骤见 [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md)。

---

## 六、API 接口速览

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/keywords` | 关键词列表（含热点数） |
| `POST` | `/api/keywords` | 新增关键词 |
| `PUT` | `/api/keywords/:id` | 修改关键词 |
| `PATCH` | `/api/keywords/:id/toggle` | 激活 / 暂停 |
| `DELETE` | `/api/keywords/:id` | 删除关键词 |
| `GET` | `/api/hotspots` | 热点列表（分页 / 筛选 / 排序） |
| `GET` | `/api/hotspots/stats` | 统计数据 |
| `POST` | `/api/hotspots/search` | 全网聚合搜索（不入库） |
| `DELETE` | `/api/hotspots/:id` | 删除热点 |
| `GET` | `/api/notifications` | 通知列表 + 未读数 |
| `PATCH` | `/api/notifications/:id/read` | 单条已读 |
| `PATCH` | `/api/notifications/read-all` | 全部已读 |
| `GET/PUT` | `/api/settings` | 系统配置读写 |
| `POST` | `/api/check-hotspots` | 手动触发一次巡检 |

**WebSocket 事件**：客户端 `subscribe / unsubscribe`（按关键词订阅房间）；服务端推送 `hotspot:new`、`notification`。

---

## 七、Agent Skills 技能包

`skills/hot-monitor` 是一个**无需后端、无需数据库**的独立技能包，可被主流 AI 编程工具加载：

```bash
cd skills/hot-monitor
pip install requests beautifulsoup4
export TWITTER_API_KEY=your_key    # 可选

python scripts/search_web.py "AI programming" --sources bing,hackernews
python scripts/search_china.py "AI编程" --sources sogou,bilibili,weibo
python scripts/search_twitter.py "AI programming"    # 需 Key
```

脚本统一输出 JSON，Agent 依据 `references/analysis-guide.md` 自行完成真实性 / 相关性 / 重要性分析，并用 `generate_report.py` 生成 Markdown 报告。详见 [skills/hot-monitor/SKILL.md](skills/hot-monitor/SKILL.md)。

---

## 八、相关文档

- [本地运行指南](docs/LOCAL_SETUP.md) — 环境准备与逐步启动
- [API 接入说明](docs/API_INTEGRATION.md) — 接口对接细节
- [需求文档](docs/REQUIREMENTS.md) — 功能需求来源
- [Agent Skills](skills/hot-monitor/SKILL.md) — 技能包使用说明
