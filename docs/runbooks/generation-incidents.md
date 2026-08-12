# Generation 常见故障

## Worker 僵尸

核对 heartbeat、数据库状态与 BullMQ job。等待 `GENERATION_HEARTBEAT_TIMEOUT_MS` 后由监控器条件终结；不得由多个操作者直接改状态。按 generation ID 验证 `WORKER_LOST` 终态事件。

## Outbox 积压

检查数据库、Redis 和 BullMQ 连接，再检查未发布 outbox 年龄与数量。恢复 dispatcher 后确认同一 generation 只生成一个固定 job ID。禁止删除未发布记录来降低告警。

## 供应商故障

按错误码区分认证、限流、上游 5xx 和超时。首 delta 前仅使用既定有限重试；首 delta 后保留部分回答并明确失败。持续故障时停止扩大并发，通知用户，恢复后以假供应商/受控冒烟验证。
