# 阶段 9 性能基线与运行参数

## 已冻结参数

| 参数                                |  默认值 | 目的                                                     |
| ----------------------------------- | ------: | -------------------------------------------------------- |
| `LLM_CONTEXT_WINDOW`                |   65536 | 模型上下文窗口；输入预算为该值减最大输出                 |
| `LLM_MAX_OUTPUT_TOKENS`             |    8192 | 预留输出上限，启动时校验小于上下文窗口                   |
| `GENERATION_DELTA_FLUSH_MS`         |   30 ms | 合并上游小增量，降低 Redis 与浏览器事件频率              |
| `GENERATION_DELTA_MAX_CHARS`        |     384 | 大增量立即发布，限制可见延迟                             |
| `GENERATION_CHECKPOINT_INTERVAL_MS` |  750 ms | PostgreSQL 时间型 checkpoint 门槛                        |
| `GENERATION_CHECKPOINT_MAX_CHARS`   |    3072 | PostgreSQL 内容型 checkpoint 门槛                        |
| `GENERATION_HEARTBEAT_INTERVAL_MS`  | 5000 ms | Worker 与并发许可续租心跳                                |
| Markdown 流式渲染间隔               |  120 ms | 流式阶段降低整棵 Markdown AST 重建频率，终态立即完整渲染 |

## 长对话策略

- 消息 API 使用 `(conversation_id, created_at DESC, id DESC)` 键集分页；页面只按需载入历史页。
- 离屏消息使用浏览器 `content-visibility` 跳过布局与绘制，保留可访问 DOM 和动态消息高度。
- 上下文使用保守 token 估算。保留 system 与最近轮次，普通历史从最旧消息开始按整条消息裁剪；单条最新输入超限时只保留可容纳的尾部。
- 上下文裁剪日志只包含 generation ID、数量与估算 token，不包含消息内容。

## 查询计划检查

应用迁移并导入 1000+ 消息测试数据后，使用 `EXPLAIN (ANALYZE, BUFFERS)` 验证：

```sql
SELECT id, role, status, content, created_at
FROM messages
WHERE conversation_id = '<conversation-uuid>'
  AND (created_at, id) < ('<cursor-time>', '<cursor-uuid>')
ORDER BY created_at DESC, id DESC
LIMIT 51;
```

预期使用 `messages_conversation_id_created_at_id_idx`，不得对 `messages` 做全表排序。Outbox backlog 应使用部分索引 `outbox_events_unpublished_created_at_idx`。

## k6 基线

`tests/performance/chat-load.js` 默认运行 100 VU、5 分钟，并断言 generation 创建 p95 小于 300 ms。测试凭据只通过环境变量提供，不写入仓库或输出。示例：

```bash
k6 run -e ACCESS_COOKIE='…' -e CSRF_TOKEN='…' \
  -e CONVERSATION_ID='…' tests/performance/chat-load.js
```

30 分钟 SSE 长连接、Redis Stream/Hash/Lua 吞吐和浏览器内存基线需要在与生产规格一致的环境执行并记录机器规格、数据量、p50/p95/p99、错误率与前后内存。本地功能测试不能替代该验收证据。
