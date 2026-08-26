# 两个对话切换时，流式输出到底发生了什么

## 1. 先记住一句话

**切换对话只切换浏览器正在展示的数据，不会切换或停止后台生成任务。**

一个 generation 从提交到显示，走的是这条链：

```text
浏览器发送消息
  → API 在 PostgreSQL 创建任务
  → Outbox 把任务交给 BullMQ
  → Worker 独立调用模型
  → Worker 把增量写入 Redis
  → 一条用户级 SSE 把所有对话的事件发给浏览器
  → 浏览器按 generationId 分开保存
  → 当前页面只展示选中的 conversationId
```

React 对话页面不拥有生成任务，SSE 也不属于某一个对话。因此页面从 A 切到 B，不会触碰正在生成的 A。

## 2. 各组件只负责什么

| 组件             | 职责                                     | 不负责什么                |
| ---------------- | ---------------------------------------- | ------------------------- |
| PostgreSQL       | 保存任务、消息和最终结果                 | 不承担逐字实时传输        |
| Outbox + BullMQ  | 可靠地把 generation 交给 Worker          | 不渲染页面                |
| Worker           | 唯一允许调用模型并推进 generation 的进程 | 不关心用户当前看 A 还是 B |
| Redis            | 保存实时快照和短期事件流                 | 不是永久最终数据源        |
| 用户级 SSE       | 用一条连接传输该用户所有 generation 事件 | 不为每个对话单独建连接    |
| 浏览器全局 Store | 按 generationId 保存 A、B 的实时状态     | 不执行模型请求            |
| ConversationView | 展示当前 conversationId 对应的数据       | 不控制后台任务生命周期    |

## 3. 先搞懂这些概念和数据格式

### 3.1 Outbox 和 BullMQ：为什么不直接让 API 调 Worker

#### BullMQ 是什么

BullMQ 是基于 Redis 的任务队列库。可以把它理解成一个待办任务中心：

```text
API 是生产者（Producer）
  → 向队列放入 Job

BullMQ/Redis 保存待执行 Job
  → 等待消费者领取

Worker 是消费者（Consumer）
  → 领取 Job 并执行生成
```

本项目放入 BullMQ 的 Job 很小：

```json
{
  "generationId": "e4a82a0f-350c-4127-937b-4e4a48e9762b"
}
```

Job 不携带完整提示词。Worker 根据 `generationId` 回 PostgreSQL 查询消息和 generation，这样队列里不复制敏感正文，数据库仍是权威来源。

队列解决三个问题：

1. API 可以快速返回 `202 Accepted`，不必让 HTTP 请求等待几十秒；
2. Worker 可以按配置控制并发，避免同时调用过多模型请求；
3. 任务失败可以重试，API 和 Worker 也可以独立扩容、重启。

#### Outbox 是什么

Outbox 直译是“发件箱”。这里指 PostgreSQL 的 `outbox_events` 表。

它解决“数据库已经创建任务，但队列消息没发成功”的双写问题。假如没有 Outbox，API 可能这样执行：

```text
步骤 1：PostgreSQL 创建 generation 成功
步骤 2：向 BullMQ 发 Job
```

如果进程恰好在两步之间崩溃，数据库里有 generation，但队列里没有 Job，这个任务将永远没人执行。

本项目改成：

```text
同一个 PostgreSQL 事务：
  创建用户消息
  创建 assistant 占位
  创建 generation
  创建 outbox_events 行

事务提交后：
  Outbox Dispatcher 周期扫描 published_at IS NULL 的行
  → 投递 BullMQ
  → 成功后填写 published_at
  → 失败则保留未发布状态，下个周期重试
```

默认扫描周期是 500ms。多个 API 实例使用 `FOR UPDATE SKIP LOCKED`，避免重复领取同一批 Outbox 行。

即使“队列写成功、填写 `published_at` 前”进程崩溃，下一次可能再次投递，但本项目把 `generationId` 同时用作 BullMQ `jobId`，重复投递不会创建两个不同任务。这就是幂等。

一句话总结：

```text
Outbox 保证任务意图不会丢；BullMQ 负责排队、重试和把任务交给 Worker。
```

### 3.2 Worker：不是普通 API 请求处理器

Worker 不是某种特殊语言概念，它是架构中的“后台任务进程”。本仓库的 `apps/worker` 是独立 NestJS 应用，但它的核心身份不是提供业务 API，而是运行 BullMQ Consumer：

```text
API 进程
  接收短 HTTP 请求
  做认证、授权、创建 generation
  不调用模型

Worker 进程
  长期监听 BullMQ
  领取 generation Job
  调用 LLM Provider
  持续写 Redis 事件
  周期写 PostgreSQL checkpoint
  最终写 PostgreSQL 完整结果
```

Worker 暴露的 HTTP 端口主要用于健康检查，不代表生成过程是通过“Worker API 接口”触发的。真正触发生成的是 BullMQ Job。

Worker 独立存在的意义是隔离长耗时和不稳定任务：

- 用户关闭页面，Worker 不受影响；
- API 重启，不必终止正在执行的模型请求；
- Worker 可以单独调整并发和资源；
- 模型密钥只进入 Worker，不进入 Web 或浏览器；
- Worker 是 generation 的单 Writer，避免两个进程同时拼接同一条回答。

### 3.3 Redis：实时事件层，不是最终数据库

Redis 在本项目有两个主要用途：

1. BullMQ 使用 Redis 保存队列和 Job 状态；
2. 流式系统使用 Redis 保存实时快照、事件 Stream 和 SSE 的上游数据。

对每个 generation，流式系统维护：

```text
chat:dev:evt:{userId}:gen:{generationId}:seq
  最新 sequence，例如 14

chat:dev:evt:{userId}:gen:{generationId}:state
  完整快照，例如 {content, reasoningContent, status}

chat:dev:evt:{userId}:gen:{generationId}
  该 generation 的事件 Stream

chat:dev:evt:{userId}:user
  当前用户所有 generation 共用的事件 Stream
```

Worker 每次发布事件时执行一段 Redis Lua 脚本，在一个原子操作中完成：

```text
INCR generation sequence
SET generation 完整快照
XADD generation 专属 Stream
XADD 用户级 Stream
设置 TTL 和裁剪过旧事件
```

“原子”表示这些步骤要么作为一次操作完整执行，要么不执行，其他客户端看不到写到一半的状态。否则可能出现 sequence 已经变成 14，但 Stream 里只有 13 条事件的短暂错误状态。

为什么既保存 delta 事件，又保存完整 snapshot？

- delta 很小，正常流式时只追加新字符，效率高；
- snapshot 是截至当前的完整正文，客户端缺事件或刷新时可以一次替换到最新状态；
- generation Stream 支持短期精确补拉；
- 用户 Stream 让一条 SSE 同时转发 A、B 等多个任务。

Redis 数据有 TTL，默认保留 24 小时。最终结果必须进入 PostgreSQL，因为 Redis 事件会过期，也不承担永久业务数据职责。

### 3.4 用户级 SSE：一条长连接如何传 A/B

SSE 是 Server-Sent Events，服务端通过一个长期 HTTP 响应不断向浏览器写文本帧。它是单向通道：

```text
浏览器 → API：普通 REST，用于发送消息、取消等命令
API → 浏览器：SSE，用于推送 started、delta、completed 等事件
```

“一个用户一条 SSE”更准确地说是：**同一个浏览器应用实例在路由切换期间复用一条用户级 SSE**。多个独立标签页可以各有一条连接；服务端默认限制每个用户最多 3 条，避免无限占用连接。

API 使用 Redis `XREAD BLOCK` 等待用户 Stream 新事件。默认最多阻塞 20 秒，如果没有事件，就发送一条心跳注释：

```text
: heartbeat 1787646852

```

心跳用于让浏览器、代理和负载均衡器知道连接仍然活着。因为它以 `:` 开头，SSE Parser 会忽略它，不会把它当 generation 事件。

真正的 SSE 帧类似：

```text
id: 1787646852842-0
event: message.delta
data: {"version":1,"eventId":"...","streamId":"1787646852842-0","type":"message.delta","conversationId":"b216...","generationId":"e007...","messageId":"7ba2...","sequence":2,"occurredAt":"2026-08-25T08:34:12.842Z","payload":{"delta":"流式片段-1 ..."}}

```

其中 `id` 是用户 Stream 游标。浏览器把最新游标保存到 `sessionStorage`。连接断开后，前端使用指数退避重连，并携带 `after=<最后游标>`，API 再从 Redis Stream 继续读取。

SSE 连接不是绝对不会断；设计目标是断开后可恢复、不重复拼接。

### 3.5 SSE 的 `data` 到底是什么格式

每个业务事件都使用统一 Envelope（事件信封）：

```ts
interface UserEvent {
  version: 1;
  eventId: string;
  streamId: string;
  type:
    | 'generation.started'
    | 'message.reasoning_delta'
    | 'message.delta'
    | 'message.snapshot'
    | 'generation.usage'
    | 'generation.completed'
    | 'generation.failed'
    | 'generation.cancelled';
  conversationId: string;
  generationId: string;
  messageId: string;
  sequence: number;
  occurredAt: string;
  payload: Record<string, unknown>;
}
```

各字段用途：

| 字段             | 用途                                              |
| ---------------- | ------------------------------------------------- |
| `streamId`       | 用户 SSE 的重连游标                               |
| `conversationId` | 判断事件属于 A 还是 B，以及终态后刷新哪个消息列表 |
| `generationId`   | 找到前端 Store 中对应的桶                         |
| `messageId`      | 对应正在填充的 assistant 消息                     |
| `sequence`       | 在单个 generation 内排序、去重、检测缺口          |
| `type`           | 决定是追加正文、追加 reasoning，还是改变状态      |
| `payload`        | 不同事件自己的数据，例如 `{delta: "..."}`         |

`streamId` 和 `sequence` 不是同一个东西：

- `streamId` 对整个用户的 A/B 事件统一排序，用于 SSE 续传；
- `sequence` 在每个 generation 内从 1 开始，用于正确拼接某一条回答。

### 3.6 浏览器怎样按 `generationId` 分桶

前端把“稳定数据”和“正在变化的数据”分开管理：

```text
TanStack Query
  保存从 REST API/PostgreSQL 查询到的对话和消息
  适合最终稳定数据、缓存和重新请求

Zustand Generation Store
  保存 SSE 正在推进的 generation、实时正文、连接状态和分对话草稿
  挂在路由之上，切换 A/B 不会清空
```

流式期间，页面用 Zustand 中的实时内容覆盖 PostgreSQL assistant 占位；收到终态事件后，让 TanStack Query 重新查询消息，最终回到 PostgreSQL 完整结果。

Zustand Store 的核心结构可以简化为：

```ts
interface GenerationStore {
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  generations: Record<string, ActiveGenerationState>;
  drafts: Record<string, string>;
}

interface ActiveGenerationState {
  generationId: string;
  conversationId: string;
  messageId: string;
  status: GenerationStatus;
  content: string;
  reasoningContent: string;
  lastAppliedSequence: number;
  syncState: 'synced' | 'resyncing';
  error?: string;
}
```

`generations` 就是所谓的桶，Key 是 `generationId`：

```ts
generations = {
  'e4a82a0f-...': {
    generationId: 'e4a82a0f-...',
    conversationId: '8a990e8e-...', // A
    status: 'STREAMING',
    content: 'A 已收到的正文',
    lastAppliedSequence: 14,
  },
  'e0076afd-...': {
    generationId: 'e0076afd-...',
    conversationId: 'b216f653-...', // B
    status: 'STREAMING',
    content: 'B 已收到的正文',
    lastAppliedSequence: 2,
  },
};
```

每收到一个事件，前端执行的逻辑可简化为：

```ts
const current = generations[event.generationId];

if (event.sequence <= current.lastAppliedSequence) {
  // 重复或迟到事件：忽略
}

if (event.sequence > current.lastAppliedSequence + 1) {
  // 中间缺事件：暂停追加，向服务端补拉
}

if (event.type === 'message.delta') {
  current.content += event.payload.delta;
}

if (event.type === 'message.reasoning_delta') {
  current.reasoningContent += event.payload.delta;
}

current.lastAppliedSequence = event.sequence;
```

当前 A 页面并不是把 B 从 Store 删除，而是做一次过滤投影：

```ts
Object.values(generations).filter(
  (generation) => generation.conversationId === currentConversationId,
);
```

所以切换过程是：

```text
展示 A：过滤 conversationId=A
展示 B：过滤 conversationId=B
```

底层 `generations` 对象和用户级 SSE 都没有被重建，这就是切回后能立即看到最新内容的原因。

### 3.7 首次加载、刷新和缺事件如何恢复

前端不是一打开页面就盲目连接 SSE，而是先调用 `/generations/sync`：

```ts
interface GenerationSyncResponse {
  eventCursor: string;
  activeGenerations: Array<{
    generationId: string;
    conversationId: string;
    messageId: string;
    status: GenerationStatus;
    content: string;
    reasoningContent: string | null;
    sequence: number;
  }>;
}
```

恢复顺序是：

```text
1. 获取当前活动 generation 的完整快照
2. 把它们注册进 Zustand Store
3. 保存服务端返回的用户 Stream 游标
4. 从这个游标之后建立 SSE
```

如果实时事件 sequence 出现缺口，前端请求单 generation 历史：

- Redis Stream 还在：返回遗漏的精确事件；
- 精确事件已经过期：返回 Redis 完整 snapshot；
- Redis 也过期：服务端再从 PostgreSQL checkpoint 或最终消息恢复。

### 3.8 常见专业词汇

| 词汇                | 在本项目中的含义                                         |
| ------------------- | -------------------------------------------------------- |
| 异步                | API 先返回，生成任务稍后由 Worker 完成                   |
| Producer / Consumer | 放入队列的 API / 从队列取任务的 Worker                   |
| Job                 | BullMQ 中一次 generation 待办任务                        |
| 幂等                | 同一个任务重复投递或事件重复到达，不造成重复结果         |
| Delta               | 本次新增的一小段正文或 reasoning                         |
| Snapshot            | 截至某个 sequence 的完整实时内容                         |
| Checkpoint          | 流式过程中周期写入 PostgreSQL 的部分进度                 |
| Stream              | Redis 中按 ID 排序、可继续读取的事件序列                 |
| Cursor              | 已经读到哪个 Stream ID，重连时从它后面继续               |
| Sequence            | 单 generation 内的连续事件序号                           |
| Reducer             | 根据旧状态和新事件计算新状态的纯逻辑                     |
| Projection / 投影   | 从全局 A/B 状态中筛出当前页面需要展示的部分              |
| 多路复用            | A/B 多个逻辑事件流共用一条用户 SSE                       |
| 最终一致性          | 流式中 Redis/浏览器可能领先，完成后都收敛到 PostgreSQL   |
| 单 Writer           | 同一 generation 同时只有一个 Worker 有权追加内容         |
| TTL                 | Redis Key 的存活时间，过期后自动删除                     |
| 背压                | 浏览器消费太慢时限制服务端继续堆积输出，避免内存无限增长 |

## 4. 本文使用的真实数据

简明 JSON 在：

[`examples/multi-conversation-trace.example.json`](./examples/multi-conversation-trace.example.json)

它来自一次真实 Playwright 运行。浏览器、API、PostgreSQL、Outbox、BullMQ、Worker、Redis 和 SSE 都是真实实现，只有外部模型返回由测试专用 Fake Provider 代替。

本次运行的几个 ID 是：

```text
用户           fd02625c-21fd-4d38-91fa-8452f8520042
对话 A         8a990e8e-cd8b-4b5b-9dbf-de6621a570e0
对话 B         b216f653-3198-4cbd-b21b-c151cedf730f
generation A   e4a82a0f-350c-4127-937b-4e4a48e9762b
generation B   e0076afd-92ef-4cb9-bfa8-da624347a77b
```

下面只追踪这两个 generation。

## 5. 真实流程

### T0：用户登录

浏览器进入 `/chat`，根布局建立用户级 SSE：

```http
GET /api/v1/events?after=0-0
```

此时：

```text
PostgreSQL 对话数       0
Redis 用户事件数        0
浏览器活动 generation   0
```

关键点：SSE 挂在根布局，不挂在 A 或 B 的页面组件里。

### T1：创建两个空对话

浏览器调用两次：

```http
POST /api/v1/conversations
```

PostgreSQL 新增对话 A、B，但还没有消息和 generation：

```text
conversations   2 行
messages        0 行
generations     0 行
```

创建对话本身不会产生 Redis generation Stream。

实验为了让直接通过 REST 创建的 A/B 出现在侧栏，T1 主动刷新了一次页面，所以 JSON 中 `sseRequestCount` 从 1 变为 2。这个字段是累计请求次数，不表示同时存在两条连接。后面真正执行 A/B 路由切换时，它一直保持 2。

### T2：在 A 中发送消息

浏览器在 A 中发送：

```text
浏览器并发长流式回归 A
```

API 在同一个 PostgreSQL 事务里写入四样东西：

```text
1. 用户消息
   id       = 10dd429e-f828-4526-a5cd-4db94ee86c1f
   role     = USER
   status   = COMPLETED

2. assistant 占位消息
   id       = 4abedf52-a4fe-48b1-bd3c-929531b7b653
   role     = ASSISTANT
   status   = PENDING，随后变为 STREAMING
   content  = 空字符串

3. generation A
   id                  = e4a82a0f-350c-4127-937b-4e4a48e9762b
   requestMessageId    = 用户消息 ID
   responseMessageId   = assistant 占位 ID
   status              = QUEUED

4. Outbox 事件
   type         = generation.enqueue
   aggregateId  = generation A
```

API 随即返回，不等待模型回答。

接着发生：

```text
Outbox Dispatcher 读取未发布事件
  → 使用 generation A 作为 BullMQ Job ID
  → Worker 领取 Job
  → generation A: QUEUED → STARTING → STREAMING
```

真实 T2 快照中：

```text
PostgreSQL generation A   STREAMING，lastSequence=1
PostgreSQL assistant      STREAMING，contentLength=0
BullMQ Job A              active
Redis generation A        STREAMING，sequence=4
Redis snapshot A          contentLength=381
浏览器可见回答容器        textLength=389
```

为什么 PostgreSQL 还是空的，浏览器却已经显示了 381 字符？

- Redis 每收到流式增量就推进，负责实时性；
- PostgreSQL 按 checkpoint 周期保存，不会每个字都写一次；
- 浏览器从 SSE 收到 Redis 事件，所以可以领先 PostgreSQL checkpoint；
- 浏览器容器比正文多 8 个字符，是界面标签，不是模型正文。

### T3：从 A 切换到 B

浏览器路由变为 `/chat/B`。比较切换前后：

```text
                              切换前       切换后
当前页面                      A            B
SSE 请求累计数                2            2
A PostgreSQL 状态             STREAMING    STREAMING
A BullMQ Job                  active       active
A Redis sequence              4            8
A Redis snapshot 字符数       381          889
```

这组数据就是“A 没有停止”的直接证据：页面已经显示 B，但 A 的 sequence 和正文仍继续增长。

切换路由实际只做了：

```text
当前 selector：conversationId=A
              ↓
当前 selector：conversationId=B
```

它没有调用取消 API，也没有接触 BullMQ Job 或 Worker 请求。

### T4：在 B 中也发送消息

B 按完全相同的流程创建自己的：

```text
用户消息 B
assistant 占位 B
generation B
Outbox 事件 B
BullMQ Job B
Redis snapshot/Stream B
```

此刻的真实状态：

```text
                        A                B
PostgreSQL status       STREAMING        STREAMING
Redis sequence          14               2
Redis snapshot 字符数   1655             127
BullMQ Job              active           active
```

Redis 中 A、B 各有自己的三类 Key：

```text
...:gen:{generationId}:seq     最新 sequence
...:gen:{generationId}:state   完整实时快照
...:gen:{generationId}         generation 专属事件 Stream
```

但 A、B 同时写入一条用户 Stream：

```text
chat:dev:evt:{userId}:user
```

实际捕获到的五条连续事件是：

```text
用户 Stream ID        generation   类型                  sequence
1787646852756-0       A            message.delta         12
1787646852778-0       B            generation.started    1
1787646852809-0       A            message.delta         13
1787646852842-0       B            message.delta         2
1787646852861-0       A            message.delta         14
```

因此一条 SSE 可以传输多个对话。客户端看到事件后按 `generationId` 分桶：

```text
A 桶：sequence 12 → 13 → 14
B 桶：sequence 1 → 2
```

事件虽然在网络中交错，内容却不会串到一起。

### T5：切回 A

切回 A 后，页面直接读取浏览器全局 Store 中的 A，不重新创建任务，也不重新建立 SSE。

真实数据：

```text
A PostgreSQL checkpoint 正文   1783 字符
A Redis 最新快照               2039 字符
A 浏览器回答容器               2047 字符

B Redis 最新快照               635 字符
活动 generation 圆点           2
新增 SSE 请求                  0
```

这说明两件事：

1. A 切回来立刻能显示，因为浏览器一直在后台接收并保存 A 的事件；
2. B 现在不可见，但 B 的 Redis 正文仍在增长。

### T6：A、B 全部完成

Worker 完成后，在 PostgreSQL 终态事务中保存完整 assistant 消息和 generation 状态，同时向 Redis 发布 `generation.completed`。

最终数据完全对齐：

```text
                             A             B
PostgreSQL status            COMPLETED     COMPLETED
PostgreSQL lastSequence      302           302
PostgreSQL checkpoint        302           302
PostgreSQL assistant 字符数  38592         38592
Redis status                 COMPLETED     COMPLETED
Redis sequence               302           302
Redis snapshot 字符数        38592         38592
generation Stream 事件数     302           302
BullMQ Job                   completed     completed
```

用户 Stream 总事件数是：

```text
A 的 302 条 + B 的 302 条 = 604 条
```

浏览器收到终态事件后重新查询消息，最终以 PostgreSQL 内容为准。Redis 只是实时和短期恢复层。

## 6. 把整个过程压缩成一条因果链

```text
用户在 A 发送消息
  → PostgreSQL 原子创建消息、generation A、Outbox
  → Outbox 投递 BullMQ Job A
  → Worker A 调用模型
  → Redis 保存 A 的实时快照和事件
  → 用户级 SSE 把 A 事件发给浏览器
  → 浏览器把事件存入 A 桶

用户切到 B
  → 只把页面 selector 改成 B
  → Worker A、Redis A、浏览器 A 桶全部继续工作

用户在 B 发送消息
  → 创建完全独立的 generation B
  → A/B 事件在同一用户 SSE 中交错传输
  → 浏览器根据 generationId 分别写入 A 桶和 B 桶

用户切回 A
  → 页面重新选择 A 桶
  → 立即显示已经在后台累积的内容

A/B 完成
  → Worker 写 PostgreSQL 最终消息
  → Redis/SSE 发布 completed
  → 浏览器刷新稳定查询
  → 最终以 PostgreSQL 为准
```

## 7. 哪几个 ID 分别解决什么问题

| ID               | 作用                                             |
| ---------------- | ------------------------------------------------ |
| `userId`         | 确保只能接收和查询当前用户的数据                 |
| `conversationId` | 决定事件属于哪个对话、当前页面展示哪个对话       |
| `generationId`   | 隔离 A/B 两个并发任务，也是 BullMQ Job ID        |
| `messageId`      | 指向本次 generation 正在填充的 assistant 消息    |
| `sequence`       | 保证同一个 generation 内事件有序、去重和缺口检测 |
| 用户 Stream ID   | 作为整条用户 SSE 的断线重连游标                  |

最容易混淆的是最后两个：

- generation `sequence` 只在单个 generation 内递增；
- 用户 Stream ID 对 A/B 所有事件统一排序，用于 SSE 续传。

## 8. 如何自己运行

```bash
pnpm infra:native:up
pnpm trace:multi-conversation
```

完整原始数据生成到：

```text
artifacts/multi-conversation-trace/<运行时间>/
```

这个目录始终被 Git 忽略。仓库中可提交的简明真实样本不会被普通运行覆盖；维护者需要更新样本时再显式执行：

```bash
pnpm trace:multi-conversation:export-example
```

## 9. 对照源码

- 创建 generation 事务：[`apps/api/src/generations/generations.service.ts`](../apps/api/src/generations/generations.service.ts)
- Outbox 投递：[`apps/api/src/outbox/outbox-dispatcher.service.ts`](../apps/api/src/outbox/outbox-dispatcher.service.ts)
- Worker：[`apps/worker/src/generation/generation.processor.ts`](../apps/worker/src/generation/generation.processor.ts)
- Redis 事件发布：[`apps/worker/src/events/event-publisher.service.ts`](../apps/worker/src/events/event-publisher.service.ts)
- 用户级 SSE：[`apps/api/src/events/events.service.ts`](../apps/api/src/events/events.service.ts)
- 浏览器全局管理器：[`apps/web/src/components/generation-manager.tsx`](../apps/web/src/components/generation-manager.tsx)
- 浏览器按 generation 归并：[`apps/web/src/lib/generation-store.ts`](../apps/web/src/lib/generation-store.ts)
