# 阶段 7 验收记录：Checkpoint、断线续传与跨标签

## 交付范围

本阶段补齐 generation 的有限精确重放、快照回退和持久化 checkpoint，使页面刷新、SSE 重连与独立标签能够从服务端权威状态收敛。

已交付：

- Worker 使用 Lua 原子推进 generation sequence，并同步写入 Redis 完整快照、generation Stream 和用户 Stream；
- PostgreSQL 按时间或新增内容长度周期写入 checkpoint，默认阈值为 750ms 或 3072 字符；
- checkpoint 更新带 `checkpoint_sequence` 版本条件，旧 Worker 或迟到写入不能覆盖新状态；
- Worker 启动生成时读取已持久化的部分正文和 reasoning，终态事务继续保存完整消息与 generation 状态；
- `/sync` 返回活动 generation 快照和用户事件游标，并先固定游标再读取活动任务，避免同步窗口内的新事件被跳过；
- `GET /generations/:generationId/events?after_sequence=` 原子读取 generation Stream、Redis 快照和最新序号；
- 有效序号返回连续精确事件，事件不可用时优先回退 Redis 完整快照，再回退 PostgreSQL checkpoint 或最终消息；
- 浏览器在 `sessionStorage` 持久化用户 Stream ID，并以 1s、2s、4s、8s、最高 15s 的抖动退避重连；
- 客户端 reducer 按 sequence 去重，发现缺口后进入 `resyncing` 并暂停追加，补偿未追平时重新建立事件连接；
- 首次加载和新标签通过 `/sync` 注册或更新较新的活动快照，迟到快照不会回退本地状态；
- Redis 用户 Stream 按时间窗口裁剪，generation Stream、sequence 和快照使用相同保留期 TTL，默认保留 24 小时；
- SSE 响应设置 `Cache-Control: no-cache, no-transform` 和 `X-Accel-Buffering: no`，禁止反向代理缓冲。

新增配置记录在 `.env.example`：

```dotenv
EVENT_RETENTION_MS=86400000
GENERATION_CHECKPOINT_INTERVAL_MS=750
GENERATION_CHECKPOINT_MAX_CHARS=3072
```

## 恢复与一致性语义

- generation Stream 使用 `<sequence>-0`，用户 Stream 使用 Redis 自动生成的时间 ID，两类游标不会混用；
- sequence 小于或等于 `lastAppliedSequence` 的事件按重复或迟到事件忽略；
- sequence 大于期望值时不追加正文，必须先通过单 generation 补偿恢复连续状态；
- `message.snapshot` 使用替换语义，并将 `lastAppliedSequence` 推进到 `snapshotSequence`；
- `/sync` 快照只覆盖缺失或更旧的浏览器状态，多个标签分别建立 SSE 连接且不依赖 `BroadcastChannel` 保证正确性；
- Redis 恢复窗口过期后不保证逐 delta 重现，但 PostgreSQL checkpoint 或最终消息保证当前完整内容可恢复；
- 最终完成、失败和取消路径仍在数据库事务内保存消息与 generation 终态。

## 自动化验证

本阶段新增或更新以下覆盖：

- Worker 集成测试验证 Redis sequence、完整快照、两条 Stream 和 TTL 在同一次发布中推进；
- Worker 集成测试验证流式生成期间写入 PostgreSQL checkpoint；
- Web 单元测试验证重复事件忽略、缺口暂停、连续补偿和快照替换；
- API E2E 回归验证 generation 查询和取消的用户授权隔离；
- Playwright 验证刷新后从 PostgreSQL 最终消息恢复；
- Playwright 默认执行 20 轮多对话竞态，每轮多次切换路由，并验证单标签只建立一条用户级 SSE；
- Playwright 验证停止一个 generation 不影响另一个对话完成。

阶段验证结果：

```text
pnpm format:check  通过
pnpm lint          通过
pnpm typecheck     通过
pnpm test          通过
pnpm build         通过
pnpm test:e2e      通过
```

其中 API E2E 为 3 个套件、14 项测试，Worker E2E 为 3 个套件、7 项测试，Web Playwright 为 3 项测试。Worker E2E 另连续执行三次，用于确认取消与 checkpoint 场景没有竞态失败。自动化测试使用测试供应商，不会调用 DeepSeek 或 OpenAI。

## 验收结论与剩余证据

当前实现和自动化测试已经证明 sequence 幂等归并、缺口暂停、精确补偿、快照替换、周期 checkpoint、Redis 有限保留、最终 PostgreSQL 持久化和 SSE 无缓冲响应头。

以下计划门槛尚缺专门的自动化测量，不能仅凭现有回归测试宣称完成：

- 模拟 Redis 事件实际过期后，端到端验证 snapshot fallback；
- 两个独立浏览器标签同时观察同一活动 generation，并比较最终内容 hash；
- 人为断开并恢复 SSE 网络连接，验证持久游标无重复、无遗漏；
- 采集刷新恢复耗时样本并计算 p95，与项目 SLO 对比；
- 在实际部署的反向代理后验证 SSE 数据不会被缓冲。

因此，阶段 7 的恢复实现已交付并通过现有全量门禁；在上述专项测试和性能数据补齐前，验收状态应记录为“功能完成，专项恢复证据待补齐”，不应标记为最终关闭。
