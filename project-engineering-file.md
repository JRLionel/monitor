# 项目工程档案：HotPulse · AI 热点监控工具

## 1. 项目概况
- **一句话目标**：输入关键词，从全网 8+ 源自动抓取并用 AI 甄别/分析热点，通过 WebSocket + 邮件 + 站内通知三通道推送；能力可封装为 Agent Skills 复用。
- **当前阶段**：⑤ 部署运维 / 文档收尾（代码功能已完整，2026-11-18 完成 README 重写与架构梳理）
- **最后更新**：2026-11-18

## 2. 技术栈与版本（版本号取自各 package.json，已核实）
| 层 | 技术 | 版本 |
|----|------|------|
| 前端 | React / Vite / TypeScript | 19.2 / 7.2 / 5.9 |
| UI | Tailwind CSS / Framer Motion / lucide-react | 4.1 / 12.31 / 0.563 |
| 后端 | Express / TypeScript / tsx | 5.2 / 5.9 / 4.21 |
| ORM/DB | Prisma / SQLite | 6.19 / file:./dev.db |
| AI | 自研多厂商 Provider（OpenAI 兼容 HTTP，无 SDK） | — |
| 采集 | axios / cheerio / twitterapi.io | 1.13 / 1.1 / — |
| 实时 | socket.io / socket.io-client | 4.8.3 |
| 邮件 | nodemailer | 8.0 |
| 定时 | node-cron | 4.2 |
| 测试 | vitest | 4.0 |

## 3. 架构决策记录（ADR，只增不删）
- **ADR-001 模块化单体**：前后端分离但后端保持单体分层（routes/services/jobs）。理由：单用户工具、规模小，微服务属过度设计。代价：单体随功能扩张会变大。状态：有效。
- **ADR-002 SQLite + Prisma**：本地轻量存储。理由：零运维、单用户足够。代价：不支持并发写与多机部署。状态：有效；多用户/上云时需替换为 PG/MySQL。
- **ADR-003 AI 通过自研多厂商 Provider 统一接入**：以 OpenAI 兼容 Chat Completions 为内部协议，`catalog.ts` 描述厂商差异，`openaiCompatible.ts` 统一发请求，默认 DeepSeek `deepseek-flash`；支持 DeepSeek / 小米 MiMo / OpenCode Go 在页面切换。理由：不绑定单一厂商、不引入 SDK 依赖、新增厂商只改配置。代价：依赖外部 API 与额度；已实现无 Key 降级逻辑。状态：有效（取代原 OpenRouter 方案）。
- **ADR-004 多源并行 + 容错采集**：`Promise.allSettled` 并发，单源失败不影响整体；各源独立 RateLimiter + 随机 UA。理由：稳定性与反爬。代价：抓取结果受各平台页面结构影响，易失效。状态：有效。
- **ADR-005 Query Expansion + 阈值过滤降本提精**：AI 先扩展关键词变体做文本预匹配，再以 isReal / relevance≥50 / 提及判断三层过滤。理由：减少无效 AI 调用、提升精度。代价：阈值需按场景调优。状态：有效。
- **ADR-006 WebSocket 按关键词房间推送**：客户端订阅 `keyword:<词>` 房间，服务端定向 emit `hotspot:new`。理由：避免广播无关热点。状态：有效。
- **ADR-007 Agent Skills 完全自包含**：`skills/hot-monitor` 独立于后端/DB，Python 脚本采集 + Agent 自身分析。理由：可脱离 Web 服务在多 AI 工具中使用。状态：有效。

## 4. 模块清单与进度
| 模块 | 状态 | 说明 |
|------|------|------|
| 关键词管理（增删改/激活/扩展/账号检测） | 已完成 | routes/keywords + ai.expandKeyword + chinaSearch.detectAndFetchAccount |
| 热点采集与分析 | 已完成 | jobs/hotspotChecker 编排 6 源并行 + AI 三层分析 |
| 信息展示与筛选 | 已完成 | App.tsx 三视图 + FilterSortBar + 5 种排序 |
| 通知系统 | 已完成 | Socket.io 房间推送 + Nodemailer + 站内通知 CRUD |
| 全网搜索 | 已完成 | POST /hotspots/search，前端内存筛选排序 |
| Agent Skills | 已完成 | SKILL.md + 4 个 Python 脚本 + 2 份 references |
| 单元测试 | 部分 | 仅 aiRelevance / sortHotspots 两个测试文件 |
| README / 文档 | 已完成 | 2026-11-18 重写 README，架构+模块+接口+快速开始 |

## 5. 接口约定（契约，实现不得擅自偏离）
- **前缀**：`/api`；Vite 代理 `/api` 与 `/socket.io` → `http://localhost:3001`。
- **关键词**：`GET/POST /keywords`、`PUT/DELETE /keywords/:id`、`PATCH /keywords/:id/toggle`；text 唯一，重复返回 409。
- **热点**：`GET /hotspots`（query: page,limit,source,importance,keywordId,isReal,timeRange,sortBy,sortOrder；返回 `{data, pagination}`）、`GET /hotspots/stats`、`POST /hotspots/search`（body: `{query, sources}`）、`DELETE /hotspots/:id`。
- **通知**：`GET /notifications`（返回 `{data, unreadCount, pagination}`）、`PATCH /notifications/:id/read`、`PATCH /notifications/read-all`、`DELETE /notifications/:id`、`DELETE /notifications`。
- **设置**：`GET/PUT /settings`（键值 map，密钥类字段返回掩码）、`GET/PUT /settings/:key`。
- **模型服务**：`GET /ai/providers`（厂商与模型清单、配置状态）、`PUT /ai/config`（保存厂商/模型/密钥）、`POST /ai/test`（健康检测，返回 `ok`、`latencyMs` 或错误原因）。
- **运维**：`GET /health`、`POST /check-hotspots`（同步执行巡检）。
- **WebSocket**：客户端 `subscribe(keywords[])` / `unsubscribe(keywords[])`；服务端事件 `hotspot:new`、`notification`。

## 6. 已知风险
- 采集依赖各平台页面 DOM 结构与公开 API，平台改版会导致解析失效（需定期验证）。
- SQLite 单机文件存储，不适合多用户并发 / 上云；ADR-002 已标注迁移触发条件。
- AI 分析为单次调用 + 无重试队列；所选厂商额度耗尽或超时会降级为低分兜底，影响精度。
- 巡检为串行遍历关键词、每词 2s 间隔，关键词数量大时单次耗时线性增长。
- 单测覆盖不足（仅 2 个测试文件），无端到端测试。

## 7. 待办
- 补充端到端 / 路由层测试，覆盖通知与关键词接口。
- 为搜索引擎解析增加失败告警与选择器自动校验。
- 如需多用户：替换 SQLite → PG/MySQL，引入鉴权（当前无用户体系）。

---
📦 下次工程卡
- 本次已交付：重写 README（六大模块 + 系统架构 + API + 快速开始），并建立本工程档案。
- 下次回来做什么：若要扩展功能（如用户体系 / 新数据源 / 上云），带上本档案先更新 ADR 再动代码；若要评审实现，对照第 6 节风险逐项过。
- 需带来的材料：本工程档案 + 目标模块源码 + 运行环境版本（node -v）。
- 🔁 回访触发条件：新增数据源导致采集失败率上升、关键词数超过 20 个导致巡检变慢、或准备支持多用户时，回来重跑 ADR-002/004 决策。
