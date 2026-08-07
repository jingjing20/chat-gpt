# 阶段 5 验收记录：事件发布、SSE 与实时单对话

## 交付范围

本阶段打通 Worker → Redis → Event Gateway → 浏览器的用户级实时事件链路，并保持 PostgreSQL 为最终权威数据源。

已交付：

- 用户与 generation 均带 hash tag 的 Redis Key namespace；
- Lua 原子推进 generation sequence、活动快照、generation Stream 和用户 Stream；
- Worker 按时间、字符数和 reasoning/content 通道切换批量发布 delta；
- 经过认证的用户级 SSE，多 generation 共用一条连接；
- SSE 历史重放、心跳、禁用代理缓冲和客户端断开清理；
- `/sync` 活动快照与用户 Stream 游标同步读取；
- generation sequence 缺口检测和短期 Stream 补偿；
- 跨 chunk 的 SSE-over-fetch parser、指数退避重连和用户级会话游标；
- Zustand 活动 generation 覆盖层和纯事件 reducer；
- 单对话正文与 reasoning 分区流式渲染；
- generation 终态后失效 TanStack Query，并以 PostgreSQL 最终消息收敛。

## 协议与一致性

- generation Stream 使用 `<sequence>-0`，用户 Stream 使用 Redis 自动 ID；两种游标不混用；
- reducer 忽略重复或迟到 sequence，发现缺口时暂停追加并请求单 generation 补偿；
- 精确事件不可用时，补偿接口回退到 PostgreSQL 完整快照；
- 刷新页面先读取活动 generation 快照与事件游标，再建立 SSE，避免丢失已发布 delta；
- SSE 连接关闭、页面切换和浏览器路由卸载都不会取消 Worker；
- completion 事件到达后刷新稳定查询，最终内容来自 PostgreSQL，不把 Redis 当作最终存储。

## 自动化验证覆盖

- Lua 原子性：sequence、快照、generation Stream 与用户 Stream 同步推进；
- SSE parser：frame 跨 chunk、注释和多行 data；
- reducer：顺序追加、重复忽略和缺口暂停；
- API 与 Worker 原有认证、用户隔离、状态机和失败路径回归；
- 单浏览器 E2E：真实 API、BullMQ Worker、Redis、SSE 和 Next.js 链路，验证 reasoning/content 分区、最终 PostgreSQL 刷新结果和 Markdown 安全。

自动化测试使用 Worker 的测试环境 Fake Provider，不调用 DeepSeek 或 OpenAI。

## 验收结论

阶段 5 的实施任务、交付物和验收门槛已有实现与自动化证据。文本按事件持续显示且 reducer 不会重复追加；reasoning 与正文独立归并；终态刷新后读取 PostgreSQL 完整结果；关闭 SSE 不会改变 generation 生命周期。
