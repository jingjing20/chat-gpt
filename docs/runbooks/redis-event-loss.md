# Redis 事件丢失

1. 检查 Redis 健康、Stream 长度、保留期、内存淘汰和 Event Gateway 错误率。
2. 暂停非必要变更，不删除 Stream 或 generation state。
3. 若事件已超出保留期，让客户端走 PostgreSQL checkpoint/最终消息快照替换；不得伪造 sequence。
4. Redis 恢复后确认新事件 sequence 单调递增，并执行断线重连验收。
5. 记录受影响 generation ID、时间窗、恢复来源和数据一致性结果，不记录正文。
