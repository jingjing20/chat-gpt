# 阶段 4 验收记录：异步 Generation 与最终持久化

## 交付范围

本阶段只实现异步 generation 与 PostgreSQL 最终持久化。实时事件、用户级 SSE、Redis Stream 和浏览器增量渲染属于阶段 5，未在本阶段提前实现。

已交付：

- `Generation`、`GenerationAttempt`、`UsageRecord`、`OutboxEvent` 数据模型和迁移；
- `Message` 的状态、reasoning、父消息与完成时间字段；
- generation 创建、查询和取消接口；
- 同一事务内创建用户消息、assistant 占位、generation 和 outbox；
- `(user_id, idempotency_key)` 数据库唯一约束与请求哈希冲突检测；
- 使用 `FOR UPDATE SKIP LOCKED` 领取 Outbox，并用 generation ID 作为 BullMQ Job ID；
- Worker 状态机、上下文加载、Fake Provider 集成测试和真实适配器生产注入；
- 首 delta 前有限重试、首 delta 后不重试并保存部分内容；
- 取消轮询、AbortSignal、中间内容保留与条件终态写入；
- 正文、reasoning、完成原因、供应商请求 ID、用量和尝试记录持久化。

## 状态与一致性

- API 只把任务可靠写入 PostgreSQL，返回 `202 Accepted` 时不等待模型；
- Outbox 投递成功后写入 `published_at`，数据库确认失败时可用固定 Job ID 安全重投；
- Worker 只领取 `QUEUED` 或恢复 `STARTING` 任务，终态任务重复消费为空操作；
- 首个正文或 reasoning 增量将 generation 和 assistant message 转为 `STREAMING`；
- `COMPLETED`、`FAILED`、`CANCELLED` 使用条件更新，完成与取消竞态只允许一个终态获胜；
- 供应商错误只保存归一化安全信息，不保存请求内容、密钥或原始错误体；
- 发送给供应商的用户隔离标识为 HMAC-SHA256，不包含邮箱或内部用户 ID 明文。

## 自动化验证覆盖

API E2E：

- 创建接口返回 202，数据库原子产生两个消息、一个 generation 和一个 outbox；
- 相同幂等键和相同请求返回原资源；
- 相同幂等键和不同请求返回 `409 IDEMPOTENCY_KEY_REUSED`；
- Outbox 重投后 BullMQ 中仍为固定 generation Job；
- generation 查询和取消按认证用户限定作用域；
- 重复取消保持幂等。

Worker 集成测试：

- BullMQ 在 HTTP 请求生命周期外消费任务并写入完整回答；
- 首 delta 前的可重试错误会产生新 attempt，随后成功；
- 正文、reasoning、usage、finish reason 和 provider request ID 最终落库；
- 首 delta 后断连只产生一次 attempt，保留部分内容并标记 `FAILED`；
- 取消标记触发 Abort，并把 generation 和消息收敛为 `CANCELLED`。

自动化测试全部使用 Fake Provider，不调用 DeepSeek 或 OpenAI。

## 轮询验收方式

登录并创建对话后，使用带 CSRF 的请求创建 generation：

```bash
curl -i -X POST \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 7d65a111-65cc-4ee4-b099-8e54c70b82b2' \
  -H 'x-csrf-token: <csrf-token>' \
  -b cookies.txt \
  -d '{"content":"解释可靠任务队列","clientMessageId":"98cb7843-1580-4449-8735-c14476b85f2d"}' \
  http://localhost:3001/api/v1/conversations/<conversation-id>/generations
```

接口会立即返回 generation ID。随后轮询：

```bash
curl -b cookies.txt \
  http://localhost:3001/api/v1/generations/<generation-id>
```

状态将从 `QUEUED` 进入 `STARTING / STREAMING`，最终到达 `COMPLETED / FAILED / CANCELLED`。阶段 4 不承诺实时 delta；最终消息通过对话消息接口读取。

## 验收结论

阶段 4 的计划任务和验收门槛均已有实现与自动化证据。API 重启不会丢失已提交但未投递的 outbox；页面或 HTTP 连接关闭不会取消 BullMQ 任务；Worker 完成后 PostgreSQL 是最终权威数据。
