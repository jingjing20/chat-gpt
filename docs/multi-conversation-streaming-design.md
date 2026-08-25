# 多开长对话切换下的流式输出：详细设计与实现解析

## 1. 结论先行

本项目实现“多个长对话同时生成、在对话间反复切换后仍能继续丝滑流式输出”的核心，不是为每个对话各建一条 SSE，也不是让对话页面持有生成请求，而是把**生成任务、实时连接、页面视图三者彻底解耦**：

1. 生成由独立 Worker 执行，不依赖浏览器页面是否仍挂载；
2. 浏览器根布局常驻一个用户级 `GenerationManager`，用一条 SSE 接收该用户所有 generation 的事件；
3. Zustand 以 `generationId` 为键保存所有对话的实时增量，以 `conversationId` 做视图筛选；
4. 页面切换只卸载/挂载当前 `ConversationView`，不会销毁 SSE 和全局 generation 状态；
5. 每个 generation 有独立、单调递增的 `sequence`，重复事件被忽略，缺口会触发精确补偿；
6. Redis 同时维护“用户级多路复用 Stream”和“generation 级补偿 Stream”，并保存最新完整快照；
7. 刷新、断线或打开新标签时，先通过 `/sync` 恢复活动任务及游标，再续接 SSE；
8. React Query 缓存服务端消息，Zustand overlay 覆盖正在生成的 assistant 占位消息，因此切回页面可立刻显示最新内容。

因此，“丝滑”来自两个性质：**切换时不重建实时基础设施**，以及**重进视图时直接读取内存缓存而不是等待重新拉流**。

## 2. 总体架构

```text
DeepSeek / Fake Provider
          │ 上游流式事件
          ▼
apps/worker GenerationProcessor
          │ 聚合小 delta、维护完整内容
          ▼
Redis Lua 原子发布
   ├── 用户 Stream：一条 SSE 多路复用所有 generation
   ├── generation Stream：按 sequence 精确补偿
   ├── generation state：最新完整快照
   └── generation sequence：单调序号
          │
          ▼
apps/api EventsService（用户鉴权、XREAD、心跳、背压）
          │ fetch + ReadableStream SSE
          ▼
根布局 GenerationManager（页面切换时不卸载）
          │ 按 generationId 归并
          ▼
Zustand generation store
          │ 按 conversationId 投影
          ▼
ConversationView + React Query 消息缓存
```

架构计划本身已明确要求“用户级 SSE、多 generation 复用”和“generation 与页面生命周期解耦”，参见[技术选型](./project-development-plan.md#L37)及[核心设计原则](./project-development-plan.md#L216)。实际代码完整落实了这两点。

## 3. 为什么切换对话不会中断生成

### 3.1 生成任务不在 API 请求或 React 页面中执行

创建 generation 时，API 在同一个 PostgreSQL 事务内创建用户消息、assistant 占位消息、generation 和 `generation.enqueue` Outbox 事件，见 [`GenerationsService.create`](../apps/api/src/generations/generations.service.ts#L42)。浏览器拿到的是已创建任务的标识，不持有供应商连接。

实际供应商流由 Worker 的异步迭代器消费，见 [`provider.streamChat()` 消费循环](../apps/worker/src/generation/generation.processor.ts#L328)。因此：

- 路由切换不会 abort 上游请求；
- `ConversationView` 卸载不会取消 generation；
- 只有显式调用取消 API，Worker 才会通过取消轮询触发 `AbortController`，见[取消轮询](../apps/worker/src/generation/generation.processor.ts#L232)；
- 停止某一个 generation 使用独立 `generationId`，不会影响其他并发对话。

### 3.2 SSE 管理器挂在根布局，而不是对话页面

根布局在所有页面内容之外挂载 `GenerationManagerHost`，见 [`RootLayout`](../apps/web/src/app/layout.tsx#L14)。Host 获取当前用户后只挂载一个 `GenerationManager`，见 [`GenerationManagerHost`](../apps/web/src/components/generation-manager-host.tsx#L11)。

`GenerationManager` 的 effect 依赖只有 `queryClient` 和 `userId`，见[连接 effect](../apps/web/src/components/generation-manager.tsx#L18)与[依赖列表](../apps/web/src/components/generation-manager.tsx#L142)。在同一用户登录期间，从 `/chat/A` 切换到 `/chat/B` 不会触发它卸载或重连。

这意味着页面切换只改变当前展示的对话，后台仍持续接收 A、B 等所有 generation 的事件。相比“每个对话一条连接”，它还避免了频繁切换造成的握手、漏帧窗口和连接数膨胀。

## 4. 用户级 SSE 如何承载多个并发对话

### 4.1 事件自带三级路由标识

共享事件协议包含 `conversationId`、`generationId`、`messageId` 和 generation 内的 `sequence`，见 [`userEventSchema`](../packages/contracts/src/index.ts#L235)。三个 ID 分工如下：

| 字段             | 用途                                    |
| ---------------- | --------------------------------------- |
| `conversationId` | 侧边栏状态和当前页面投影                |
| `generationId`   | 并发流隔离、顺序归并、取消与补偿        |
| `messageId`      | 把实时状态覆盖到对应 assistant 占位消息 |
| `streamId`       | 用户级 Redis Stream/SSE 断线续传游标    |
| `sequence`       | 单个 generation 内的去重与缺口检测序号  |

`streamId` 和 `sequence` 不能互换：前者是一个用户所有任务的全局投递位置，后者是某一个 generation 的业务顺序。

### 4.2 Worker 一次原子发布两条 Stream 和一份快照

Worker 的 Lua 脚本在 Redis 内原子完成：

1. `INCR` generation sequence；
2. 写入最新完整 state；
3. 按 `<sequence>-0` 写 generation Stream；
4. 用 Redis 自动 ID 写用户 Stream；
5. 设置保留期并记录事件去重结果。

实现见 [`PUBLISH_SCRIPT`](../apps/worker/src/events/event-publisher.service.ts#L13)，调用及键映射见 [`EventPublisherService.publish`](../apps/worker/src/events/event-publisher.service.ts#L67)。Lua 原子性避免出现“快照已推进但事件没写入”或“两条 Stream 序号不一致”的中间状态。

用户 Stream 用于高效实时扇入：API 只需监听一个 key，就能获得该用户所有并发 generation 的事件。generation Stream 用于缺口时的定向读取，无需扫描用户的全部历史事件。

### 4.3 API 将用户 Stream 转成可恢复 SSE

`GET /events?after=<cursor>` 先从认证上下文取得 `userId`，见 [`EventsController.stream`](../apps/api/src/events/events.controller.ts#L22)。服务端随后针对该用户的 Stream 执行阻塞 `XREAD`，见 [`EventsService.stream`](../apps/api/src/events/events.service.ts#L87)，并把 Redis Stream ID 写进 SSE `id:` 字段，见[事件编码与游标推进](../apps/api/src/events/events.service.ts#L123)。

响应显式设置：

- `text/event-stream`；
- `Cache-Control: no-cache, no-transform`；
- `X-Accel-Buffering: no`。

代码见[SSE 响应头](../apps/api/src/events/events.service.ts#L64)。这可以避免代理缓存或压缩缓冲把小增量攒成“大块”，是视觉上持续流动的重要条件。

无事件时服务端发送 heartbeat，防止中间网络设施把空闲连接回收，见[心跳写入](../apps/api/src/events/events.service.ts#L97)。慢客户端则受最大缓冲字节和 drain 超时保护，见[背压控制](../apps/api/src/events/events.service.ts#L146)；连接被安全断开后客户端可依靠游标恢复，而不会无限堆积内存。

## 5. 浏览器端如何持续归并，而不受路由影响

### 5.1 使用 `fetch()` 手工读取 SSE

客户端用 `fetch()` 打开 `/api/v1/events`，显式携带 Cookie、恢复游标和 `AbortSignal`，见[建立 SSE 请求](../apps/web/src/components/generation-manager.tsx#L83)。之后循环读取 `ReadableStream`，增量解码并交给 `SseParser`，见[读取与应用事件](../apps/web/src/components/generation-manager.tsx#L97)。

手写解析器会保留跨网络 chunk 的残片，直到遇到空行帧边界，再解析 `id`、`event` 和多行 `data`，见 [`SseParser`](../apps/web/src/lib/sse-parser.ts#L10)。因此 HTTP chunk 边界与 SSE 事件边界不一致也不会造成半帧 JSON 解析失败。

每成功处理一帧后，最新 `frame.id` 写入按用户隔离的 `sessionStorage`，见[游标持久化](../apps/web/src/components/generation-manager.tsx#L103)。这既支持当前标签断线恢复，也避免不同用户复用同一个游标。

### 5.2 Zustand 是与页面无关的多 generation 状态表

全局 store 的核心结构是：

```ts
generations: Record<string, ActiveGenerationState>;
drafts: Record<string, string>;
```

定义见 [`GenerationStore`](../apps/web/src/lib/generation-store.ts#L82)，实例见[初始状态](../apps/web/src/lib/generation-store.ts#L133)。每个 generation 独立保存完整正文、推理正文、状态、最后 sequence 和同步状态，见 [`ActiveGenerationState`](../apps/web/src/lib/generation-store.ts#L7)。

收到事件时只更新 `generations[event.generationId]`，见 [`apply`](../apps/web/src/lib/generation-store.ts#L149)。所以 A、B 两个对话的 delta 不会互相覆盖；离开 A 页面时，A 的 state 仍在 store 内增长。

草稿同样按 `conversationId` 隔离，写入见 [`setDraft`](../apps/web/src/lib/generation-store.ts#L180)，页面输入框直接读取当前对话草稿，见[草稿订阅](../apps/web/src/components/conversation-view.tsx#L66)。这使频繁切换时未发送输入也不会串话。

### 5.3 当前页面只是全局状态的一张投影

`ConversationView` 通过 `selectConversationGenerations(conversationId)` 只订阅当前对话的 generation，见[选择器](../apps/web/src/lib/generation-store.ts#L106)和[页面订阅](../apps/web/src/components/conversation-view.tsx#L72)。其他对话收到 delta 时，当前正文视图不会因为无关流而重渲染。

服务端消息历史由 React Query 管理；页面再用 `messageId` 将 Zustand 中的实时 overlay 覆盖到对应 assistant 消息，见[消息与实时 overlay 合并](../apps/web/src/components/conversation-view.tsx#L101)。该组合形成两层模型：

- React Query：已持久化的权威消息、分页缓存；
- Zustand：仍在变化的实时内容和临时状态。

切回一个已访问对话时，React Query 通常已有历史缓存，Zustand 又一直保存着离开期间收到的最新正文，因此无需等待下一条 token 才能“追上”。终态事件到达后，Manager 会失效消息和会话列表查询，用数据库最终态收敛缓存，见[终态缓存刷新](../apps/web/src/components/generation-manager.tsx#L107)。

### 5.4 侧边栏也订阅同一份全局活动状态

侧边栏链接按对话计算活动 generation 数量，活动时显示状态圆点，见 [`selectConversationActivity`](../apps/web/src/lib/generation-store.ts#L116)和 [`ConversationNavLink`](../apps/web/src/components/conversation-nav-link.tsx#L22)。因此即便用户正在看 B，也能看到 A 仍在生成；这不是额外轮询，而是同一 SSE 状态的另一张投影。

## 6. 顺序保证：重复不追加，缺口先修复

网络重连和多层重试意味着“至少一次投递”比“恰好一次投递”更现实。客户端 reducer 因此按 sequence 实现幂等归并：

- `event.sequence <= lastAppliedSequence`：判定重复，忽略内容追加；
- `event.sequence === lastAppliedSequence + 1`：正常应用；
- `event.sequence > lastAppliedSequence + 1`：发现缺口，标记 `resyncing`，不追加越序 delta。

实现见 [`reduceGenerationEvent`](../apps/web/src/lib/generation-store.ts#L35)。正文和推理 delta 只有在连续时才拼接，见[事件状态转换](../apps/web/src/lib/generation-store.ts#L55)。

当 Manager 收到 `gap`，会请求：

```http
GET /api/v1/generations/{generationId}/events?after_sequence={lastAppliedSequence}
```

客户端补偿逻辑见 [`resync`](../apps/web/src/components/generation-manager.tsx#L26)，API 路由见 [`EventsController.history`](../apps/api/src/events/events.controller.ts#L46)。服务端用一次 Lua/EVAL 同时读取 generation Stream、state 和 sequence，见[恢复数据读取](../apps/api/src/events/events.service.ts#L193)：

- 事件仍完整且连续：返回缺失事件；
- Stream 已裁剪、事件不连续或 Redis 事件缺失：返回最新完整快照；
- Redis state 不可用时：回退到 PostgreSQL checkpoint/最终消息。

连续性判断与快照降级见[补偿模式选择](../apps/api/src/events/events.service.ts#L240)。快照替换还会拒绝比本地更旧的 sequence，避免迟到的恢复响应覆盖较新的实时状态，见 [`replaceSnapshot`](../apps/web/src/lib/generation-store.ts#L162)。

## 7. 刷新、断网和新标签如何恢复

### 7.1 首次挂载先同步，再打开 SSE

Manager 第一次连接前调用 `/sync`，把所有活动 generation 的最新完整状态注册进 Zustand，并保存服务端返回的用户流尾游标，见[客户端初始化](../apps/web/src/components/generation-manager.tsx#L61)。之后才用该游标打开 SSE。

服务端 `/sync` 的关键顺序是：

1. 先固定用户 Stream 当前尾游标；
2. 查询 PostgreSQL 中该用户的活动 generation；
3. 批量读取 Redis 最新 state 和 sequence；
4. Redis 缺失时回退数据库消息与 `lastSequence`。

实现见 [`EventsService.sync`](../apps/api/src/events/events.service.ts#L275)。由于游标先固定，同步期间新产生的事件一定落在游标之后，后续 SSE 能继续读取，不会形成“快照查询与开流之间”的永久丢失窗口。

### 7.2 SSE 断开后按持久游标指数退避

连接失败时，客户端把连接状态设为 `disconnected`，使用 1、2、4、8 秒递增、最大 15 秒并带 ±20% 抖动的延迟重连，见[重连策略](../apps/web/src/components/generation-manager.tsx#L132)。重连仍从 `sessionStorage` 中最后成功应用的用户 Stream ID 开始，因此 Redis 会重放断线期间的事件。

连接状态与 generation 状态分开保存。UI 会提示“实时连接已断开，正在重连；已生成内容不会丢失”，但不会错误地把 generation 标为失败，见[编辑器状态文案](../apps/web/src/components/conversation-view.tsx#L227)。

### 7.3 Worker 还会周期写 PostgreSQL checkpoint

Redis 是快速恢复层，不是永久事实源。Worker 按时间间隔或累计字符数写 checkpoint，见[delta 刷新与 checkpoint 触发](../apps/worker/src/generation/generation.processor.ts#L281)。数据库更新以 `checkpointSequence < input.sequence` 为条件，随后在同一事务更新消息正文，见 [`writeCheckpoint`](../apps/worker/src/generation/generation.processor.ts#L565)。

Worker 重启后会从数据库已保存的 content、reasoning 和 sequence 继续构造状态，见[checkpoint 恢复初始化](../apps/worker/src/generation/generation.processor.ts#L185)。终态则先持久化完整消息/generation，再发布 completed、failed 或 cancelled 事件；完成路径见[完成事件发布](../apps/worker/src/generation/generation.processor.ts#L425)，失败路径见[失败收敛](../apps/worker/src/generation/generation.processor.ts#L454)。

## 8. “丝滑”的 UI 细节

### 8.1 增量批处理降低渲染和 Redis 压力

Worker 不机械地把供应商每个微小 token 都透传到内部系统，而是按最大字符数或最大等待时间合并 delta，见 [`bufferDelta`](../apps/worker/src/generation/generation.processor.ts#L312)。这在流畅度和开销之间取得平衡：用户仍看到高频更新，但浏览器渲染、Redis 写入和 SSE 帧数量不会随 token 粒度无限放大。

### 8.2 只在相关内容变化时驱动当前视图

页面生成 `streamingSignature`，只编码当前对话活动 generation 的 ID、正文长度、推理长度和状态，见[流式签名](../apps/web/src/components/conversation-view.tsx#L78)。其他对话的事件不会改变该签名，也不会触发当前页面的跟随滚动。

### 8.3 自动跟随尊重用户阅读位置

用户接近底部时，新内容到达会在 `useLayoutEffect` 内立刻滚到底部；用户主动向上阅读时，则停止自动跟随并显示“回到最新消息”按钮，见[流式滚动跟随](../apps/web/src/components/conversation-view.tsx#L312)和[滚动意图更新](../apps/web/src/components/conversation-view.tsx#L349)。

切回仍在生成的对话时，滚动恢复策略会优先定位到最新内容，相关计算和逐帧恢复见[切换后的滚动恢复](../apps/web/src/components/conversation-view.tsx#L269)。这避免恢复旧 scroll offset 后用户误以为流式输出停住。

## 9. 并发、安全与资源边界

### 9.1 用户级 generation 并发限制

创建任务前，API 在用户级 PostgreSQL advisory transaction lock 内统计活动 generation，并执行并发上限，见[并发计数与限制](../apps/api/src/generations/generations.service.ts#L58)。锁使同一用户的并发创建不会同时读到相同旧计数而突破上限。

### 9.2 创建幂等与 Outbox

generation 使用用户作用域的幂等键；重复请求返回已有结果，冲突复用则拒绝，见[幂等入口](../apps/api/src/generations/generations.service.ts#L42)及[已有任务解析](../apps/api/src/generations/generations.service.ts#L313)。消息、generation 与 enqueue Outbox 同事务提交，避免“消息已显示但任务未入队”或“任务入队但数据库无记录”。

### 9.3 全链路用户隔离

事件接口不接受客户端传入 userId，而从认证会话读取，见 [`EventsController`](../apps/api/src/events/events.controller.ts#L22)。generation 补偿在查 Redis 前先用 `{ id: generationId, userId }` 校验所有权，见[history 授权检查](../apps/api/src/events/events.service.ts#L193)。SSE 还限制单用户连接数，见[连接上限](../apps/api/src/events/events.service.ts#L47)。

## 10. 关键时序解析

### 10.1 同一标签内 A/B 对话来回切换

```text
用户在 A 发送 ──> API 创建 gen-A ──> Worker 开始生成
                       │
根布局 SSE <──────── 用户 Stream <──── delta-A
    │
Zustand[gen-A] 持续增长
    │
用户切到 B：ConversationView(A) 卸载，但根布局 SSE 与 store 不变
    │
用户在 B 发送 ──> API 创建 gen-B ──> Worker 并发生成
    │
同一 SSE 交错收到 delta-A / delta-B，按 generationId 分桶
    │
用户切回 A：React Query 历史 + Zustand[gen-A] overlay 立即渲染最新正文
```

### 10.2 断线期间发生 100 个增量

```text
已应用到用户 streamId=123-0、gen sequence=20
    │
网络断开，Worker 继续发布 sequence 21..120
    │
客户端恢复后 GET /events?after=123-0
    │
用户 Stream 重放断线事件
    ├── 重复 sequence <= 20：忽略
    ├── 连续 21..120：顺序追加
    └── 若发现缺口：读取 generation Stream 或完整 snapshot
```

## 11. 自动化验证证据

项目不是只依赖设计假设，Playwright 覆盖了核心体验与恢复语义：

- 两个对话并发生成，切回后正文继续增长且侧边栏圆点保留，见[并发切换用例](../apps/web/test/multi-conversation.e2e-spec.ts#L102)；
- 切回活动对话后滚动到最新消息，见[活动生成滚动用例](../apps/web/test/multi-conversation.e2e-spec.ts#L56)；
- 断网后按游标重连，验证 100 个片段不重复、不遗漏，见[断网恢复用例](../apps/web/test/multi-conversation.e2e-spec.ts#L262)；
- 两个独立浏览器上下文最终内容摘要一致，且取消操作跨端收敛，见[跨标签用例](../apps/web/test/multi-conversation.e2e-spec.ts#L296)；
- 活动 generation 刷新恢复 p95 小于 2 秒，见[恢复性能用例](../apps/web/test/multi-conversation.e2e-spec.ts#L334)；
- 已缓存对话切换可见 p95 小于 200 ms，见[切换性能用例](../apps/web/test/multi-conversation.e2e-spec.ts#L353)。

## 12. 设计取舍与当前边界

### 12.1 为什么不是每个对话一条 SSE

用户级连接把多个 generation 多路复用到同一通道，减少连接数、切换握手和浏览器资源占用。代价是客户端必须正确按 `generationId` 分桶，服务端必须提供 generation 级 sequence 与定向补偿；本项目用双 Stream 解决了这个代价。

### 12.2 为什么同时需要 Redis 和 PostgreSQL

- Redis：低延迟增量、短期精确重放、活动完整快照；
- PostgreSQL：任务状态、最终消息、周期 checkpoint 和永久事实。

如果每个 token 都写 PostgreSQL，事务与 WAL 成本过高；如果只依赖 Redis，超出保留窗口或 Redis 故障后又缺少持久恢复能力。

### 12.3 `sessionStorage` 的语义

用户 Stream 游标保存在 `sessionStorage`，因此同标签刷新可以续接；独立标签有自己的游标和 SSE。正确性不依赖 `BroadcastChannel`：新标签通过 `/sync` 获取活动快照和新基线游标，各自最终收敛。代价是同一用户每多开一个标签会多一条 SSE，因此服务端设置了每用户连接上限。

### 12.4 Redis 保留窗口之外的恢复

短期窗口内可精确重放；generation Stream 已裁剪时返回完整 state；Redis state 也不可用时回退 PostgreSQL checkpoint/最终内容。因此系统保证最终收敛，但不会宣称在无限时间后仍能逐 token 精确复现历史动画。

## 13. 可复用的实现原则

若要在其他项目复制该能力，应保持以下不可拆分的约束：

1. 生成执行必须脱离页面和同步 API 请求生命周期；
2. 实时连接必须提升到路由之上的常驻层；
3. 用户级通道做多路复用，事件必须携带 conversation、generation、message 标识；
4. 每个 generation 必须有服务端生成的单调 sequence；
5. reducer 必须幂等，发现缺口时禁止直接追加越序 delta；
6. 必须同时具备游标重放、generation 定向补偿和完整快照降级；
7. 实时 overlay 与持久消息缓存要分层，并在终态重新校验数据库；
8. 连接状态不能等同于任务状态；路由离开也不能等同于取消；
9. SSE 必须关闭代理缓冲，并有 heartbeat、背压和连接上限；
10. 用断网、刷新、跨标签、并发切换和性能阈值测试验证，而不只测试单条正常流。

这套方案的本质是：**后台任务持续产生可恢复的有序事件，常驻客户端持续归并全局状态，路由页面只负责低成本投影**。三层职责分开后，对话切换就从“中断并重连流”降级为“切换一个本地 selector”，从而获得当前项目表现出的连续流式体验。
