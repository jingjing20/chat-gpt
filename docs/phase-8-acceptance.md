# 阶段 8 验收记录

## 已实现能力

- Worker 使用 Redis ZSET + Lua 原子获取用户、全局、供应商三级并发许可；许可带租约、心跳续期，并在所有退出路径释放。
- generation 通过 PostgreSQL `writer_token` 条件领取，attempt 记录同一 token；终态提交使用条件状态转换，竞争 Writer 不能重复提交终态。
- Worker 周期更新数据库 heartbeat；僵尸检查仅在 heartbeat 超时且 BullMQ Job 不活跃时，以 `WORKER_LOST` 终结任务并保留 checkpoint partial。
- DeepSeek 429、500、503 仅允许首 delta 前重试，使用带抖动的指数退避、最大延迟和最大 attempt 数；首 delta 后错误直接安全终结。
- DeepSeek 401、402 记录包含 generation ID、attempt 序号、provider 和安全错误码的高优告警，不记录消息内容或密钥。
- Redis 事件发布使用 event ID 去重并执行有限短重试；PostgreSQL 短暂连接错误对关键领取、checkpoint 和 attempt 更新执行有限短重试。
- Outbox 周期扫描 backlog；暂时不可用时保留未发布行并在下一周期继续，BullMQ 重试有固定上限和指数退避。
- SSE 对每用户连接数、单连接缓冲字节和 drain 等待时间设限；慢客户端会被安全断开，并可通过游标、Redis 快照或 PostgreSQL checkpoint 恢复。
- Web 明确展示排队、生成、取消、失败和实时连接断开状态；失败回答保留 partial，并提供显式“重新生成”入口。重试创建带父消息链的新 generation，使用幂等键且不会自动触发新的计费请求。
- `GET /api/v1/generations/:generationId/attempts` 按认证用户限定作用域，返回完整 attempt 顺序和供应商请求 ID，支持按 generation ID 排查链路。

## 自动化证据

- 首 delta 前 429 可有限重试并最终完成；首 delta 后断连不重试且 partial 被保存。
- 两个 Processor 同时处理同一 generation 时，仅创建一个 attempt、调用一次供应商并提交一个终态。
- 三级许可达到上限后拒绝第二个持有者，释放后可再次领取。
- heartbeat 超时且 Job 不活跃时，僵尸任务以 `WORKER_LOST` 失败，partial 与 attempt 链路保留。
- 全仓 `format:check`、`lint`、`typecheck`、`test`、`build`、`test:e2e` 通过。

## 验收结论

阶段 8 的实现任务和验收门槛已有实现与自动化证据。故障恢复均采用有限次数、带租约或条件状态转换的机制，不会自动形成无限重试或双 Writer。
