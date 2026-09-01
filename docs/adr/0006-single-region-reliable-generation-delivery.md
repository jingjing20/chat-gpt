# ADR-0006：单地域部署与可靠 Generation 交付

- 状态：已接受
- 日期：2026-09-01

## 背景

系统已有 PostgreSQL、BullMQ、Redis Stream 和 SSE，但原实现只用 Outbox 保证任务入队，Worker 的终态数据库提交与 Redis 终态事件发布之间仍存在崩溃窗口。认证限流和 SSE 连接上限也只在单个 API 进程内有效。项目现阶段不需要多地域，也只有一个 DeepSeek 模型。

## 决策

采用单地域、多实例部署：Web、API 和 Worker 可水平扩容；PostgreSQL 使用单主高可用服务；生产环境使用两个相互独立的单主高可用 Redis，分别承载 BullMQ 队列和认证限流、SSE 租约、生成事件等控制数据。本地与测试环境可以让两个 URL 指向同一 Redis。当前不采用 Redis Cluster、多地域写入、模型注册中心或独立 Event Gateway。

`generation.enqueue` 和 `generation.completed/failed/cancelled` 都写入通用 Outbox。Worker 在同一数据库事务中提交消息、Generation、Attempt、Usage、未读状态和终态 Outbox。Relay 以短事务领取、在事务外投递、再以短事务确认；投递使用稳定事件 ID 去重，失败指数退避，非法或超过上限的记录进入死信且不自动删除。Relay 可内嵌 API，也可通过无 HTTP 的独立进程运行；独立部署时 API 设置 `OUTBOX_RELAY_ENABLED=false`。

浏览器为逻辑操作持久复用客户端消息 ID 与幂等键。新对话和首个 Generation 使用一个原子接口。`/sync` 接收浏览器已知的 Generation ID，并以 PostgreSQL 权威终态修复漏掉终态事件的本地投影。

认证限流按 IP、规范化账号和刷新会话多维度在控制 Redis 原子执行；SSE 连接数使用分布式租约。两者在控制 Redis 不可用时拒绝进入。刷新令牌重放会撤销该轮换节点的全部后代。

## 数据保留

- 对话、消息和 Generation 由用户控制，不自动删除；
- UsageRecord 保留 24 个月；普通审计 180 天；会话拒绝和永久删除审计保留 24 个月；
- 已发布 Outbox 保留 7 天；未发布和死信不自动删除；
- Redis 事件默认保留 24 小时；浏览器终态投影最多保留 100 条且不超过 30 分钟；
- 对话列表默认每页 50 条，Worker 上下文候选消息有硬上限。

## 影响

终态数据库事实不再依赖 Worker 在提交后继续存活；队列拥塞不会拖垮认证和实时控制面；多 API 实例共享限流和连接上限。代价是生产环境增加一个 Redis 服务和 Outbox 运维面，需要监控积压、死信和投递失败。跨地域容灾、跨标签元数据广播、多模型路由和 Event Gateway 拆分留待有明确需求时再决策。
