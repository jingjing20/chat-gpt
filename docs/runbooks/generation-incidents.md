# Generation 常见故障

## Worker 僵尸

核对 heartbeat、数据库状态与 BullMQ job。等待 `GENERATION_HEARTBEAT_TIMEOUT_MS` 后由监控器条件终结；不得由多个操作者直接改状态。按 generation ID 验证 `WORKER_LOST` 终态事件。

## Outbox 积压

检查数据库、Queue Redis、Control/Event Redis 和 BullMQ 连接，再检查未发布 Outbox 年龄、数量、租约和下次重试时间。`generation.enqueue` 失败优先排查 Queue Redis，终态事件失败优先排查 Control/Event Redis。恢复 Relay 后确认同一 Generation 的固定 Job ID 或稳定事件 ID 只产生一次业务效果。禁止删除未发布或死信记录来降低告警。

独立 Relay 使用 API 包的 `start:outbox` 入口；若它承担正式投递，HTTP API 实例设置 `OUTBOX_RELAY_ENABLED=false`。切换期间允许短暂重叠，数据库领取租约和投递去重会保护正确性。

## Outbox 死信

先按 `last_error` 区分非法载荷与外部投递失败。非法载荷必须修复产生端或执行受审计的数据修复；外部故障需先恢复依赖，再人工将确认可重试记录的 `dead_lettered_at` 清空并重置 `next_attempt_at`。不得批量删除死信，也不得在未确认终态数据库事实前伪造事件。

## 供应商故障

按错误码区分认证、限流、上游 5xx 和超时。首 delta 前仅使用既定有限重试；首 delta 后保留部分回答并明确失败。持续故障时停止扩大并发，通知用户，恢复后以假供应商/受控冒烟验证。
