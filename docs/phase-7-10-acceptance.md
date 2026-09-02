# 阶段 7～10 验收记录

日期：2026-08-20

范围：完成 `docs/project-development-plan.md` 的阶段 7～10；阶段 11 生产发布、生产域名、生产密钥、镜像发布和真实值班接收人不在本次范围。

## 最终统一门禁

- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm build` 全部通过；
- API E2E 18/18、Worker E2E 11/11、Web Playwright 11/11 全部通过；
- `git diff --check`、依赖高危漏洞审计、Gitleaks 当前目录与 23 个提交历史扫描、Trivy HIGH/CRITICAL 与秘密扫描全部通过；
- 自动化测试只使用 Fake Provider，没有调用真实 DeepSeek 或 OpenAI。

## 验收环境

- macOS arm64，Node.js 22.22.2，Chrome 151.0.7922.138；
- PostgreSQL 18.3、Redis 8.4.0，均由 `infra/native` 在仓库 `.data/native` 中运行；
- k6 2.2.0 macOS arm64 便携二进制，下载到 `/private/tmp`，未安装 Docker；
- Git 基线 `c80e0b9`，测试数据库为 `chat_test`，模型流全部使用 Fake Provider。

## 测试方法与真实性边界

不同验收目标采用了对应层级的测试，并非全部通过浏览器执行：

| 验收内容                                     | 测试手段                       | 实际运行组件                                                  |
| -------------------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| 跨窗口同步、断网重连、刷新恢复               | Playwright + 真实 Chrome       | Web、API、Worker、PostgreSQL、Redis                           |
| 事件补偿、鉴权、手动重试                     | NestJS E2E + Supertest         | 完整 API 应用、真实 PostgreSQL、真实 Redis/BullMQ             |
| 限流重试、首 delta 后失败、僵尸 Worker、取消 | Jest 集成测试 + 可编程故障注入 | Worker 状态机、真实 PostgreSQL/Redis、Fake Provider           |
| 100 用户、15 分钟全链路负载                  | k6 100 个虚拟用户              | API、Outbox、BullMQ、Worker、PostgreSQL、Redis、Fake Provider |
| 100 条 SSE、30 分钟长稳                      | Node.js Fetch 长连接脚本       | API、PostgreSQL、Redis                                        |
| PostgreSQL/Redis 重启恢复                    | Shell 实际停止并重启原生进程   | 仓库专用 PostgreSQL、Redis 及其持久化目录                     |

### 浏览器端恢复测试

`apps/web/playwright.config.ts` 会为测试启动 Web、API 和 Worker 三个独立服务，分别监听 `127.0.0.1:3000`、`127.0.0.1:3001` 和 `127.0.0.1:3002`，并连接真实的 `chat_test` 数据库和 Redis。Playwright 使用真实 Chrome 执行以下操作：

- 通过两个隔离的 Browser Context 登录同一账号和对话，比较最终回答 SHA-256，并验证任一端取消后另一端同步收敛；
- 使用 `context.setOffline(true)` 真实切断浏览器网络，恢复后重新连接 SSE，断言 1～100 号增量严格连续、无重复且无遗漏；
- 使用 `page.reload()` 执行真实页面刷新，采集活动 generation 恢复耗时并计算 p95。

因此该部分覆盖的是 `Chrome → Next.js Web → NestJS API → PostgreSQL/Redis → BullMQ Worker` 完整链路，而不是 Mock DOM。

### API 与 Worker 故障测试

API E2E 通过 NestJS `TestingModule` 在测试进程内启动完整 HTTP 应用，再由 Supertest 发出真实 HTTP 请求。虽然不额外监听固定端口，但应用连接的是真实 PostgreSQL、Redis 和 BullMQ。事件恢复用例会实际写入并过期 Redis Stream，依次验证 Redis 快照、PostgreSQL checkpoint 回退、精确游标补偿和跨用户拒绝。

Worker 测试直接执行真实 generation 状态机、数据库事务、attempt/usage 写入、Redis 事件发布、队列处理、信号量和 checkpoint 逻辑。只有外部模型供应商替换为可编程 Fake Provider，用来稳定制造首 delta 前 429/503、首 delta 后断连、认证失败、慢流、无 heartbeat 和取消等场景；自动化测试不会产生真实模型调用或费用。

### 100 用户全链路负载

`tests/performance/chat-load.js` 使用 k6 注册 100 个独立账号，为每个账号创建独立对话，并保留各自的 Cookie、CSRF Token、`clientMessageId` 和 `Idempotency-Key`。随后保持 100 VU，每个用户约每 5 秒创建一次 generation。前端不参与该项测试，因为测量目标是 generation API 和后台任务链路；实际链路为：

```text
k6 → API → PostgreSQL Outbox → Redis/BullMQ → Worker → Fake Provider
```

k6 直接统计 HTTP 与 generation 创建延迟，测试结束后另行核对 Worker 完成数量、Outbox 积压、BullMQ 历史保留数量和 Redis 状态。

### 100 条 SSE 长稳测试

`tests/performance/sse-endurance.mjs` 使用 Node.js `fetch()` 注册 100 个真实测试账号，并同时保持 100 条 `/api/v1/events?after=0-0` SSE 连接。脚本每分钟读取 `/metrics`，采集活动连接数、API 进程 RSS、接收字节数和流异常数；30 分钟后主动关闭连接，再断言连接数达到目标、没有意外断流且 RSS 没有持续不可控增长。该测试绕过浏览器渲染，专门验证 API 长连接实现和资源稳定性。

### 无 Docker 基础设施

上述测试均使用 `infra/native` 启动的仓库专用 PostgreSQL 和 Redis，监听 `127.0.0.1:15432` 与 `127.0.0.1:16379`，数据位于 Git 忽略的 `.data/native`。Docker 未参与最终验收；原生方案只用于本地开发和测试，不作为阶段 11 的生产部署方案。

## 阶段 7：恢复与跨上下文

- Redis generation Stream 实际过期后，验证 Redis 完整快照恢复；Redis 快照也缺失时验证 PostgreSQL checkpoint 回退；
- `after_sequence` 验证精确连续补偿，跨用户请求返回 404；
- Playwright 强制断网并关闭 SSE 后重连，100 个事件无重复、无遗漏；
- 两个独立浏览器 Context 的最终正文 SHA-256 一致，并验证从另一 Context 取消后收敛；
- 生成中刷新恢复的 5 个样本 p95 小于 2 秒。

结果：API E2E 18/18 通过；新增的三组恢复 Playwright 用例分别通过。

## 阶段 8：可靠性与故障注入

- 已覆盖首 delta 前 429/503 重试、首 delta 后不自动重试、双 Writer 竞争、分层信号量释放、僵尸 Worker、取消和 partial response；
- 慢 SSE 客户端覆盖缓冲区上限与 drain 超时两个失败路径；
- 数据库连接关闭/超时覆盖最多三次短退避恢复，非连接错误不重复写入；
- `tests/reliability/native-restart-drill.sh` 实际停止并重启仓库专用 Redis/PostgreSQL，恢复耗时 1 秒，两个持久化标记完整；
- 失败/取消后的“重新生成”使用独立 generation、父消息链和幂等键，并验证跨用户拒绝；
- 负载测试首次触发 Redis 8.4.0 原生崩溃；根因是 BullMQ completed 历史无界增长。现已将完成/失败 Job 各限制为 1,000 项，复测期间 completed 始终为 1,000，Redis 未再退出。

结果：故障恢复行为可预测，未发现双写、许可泄漏或无限重试。

## 阶段 9：性能

### PostgreSQL 与 Redis

- 1,200 条消息的对话查询使用 `messages_conversation_id_created_at_id_idx`，执行时间 0.037ms；
- 5,000 条 outbox（100 条未发布）使用 `outbox_events_unpublished_created_at_idx`，执行时间 0.021ms；
- Redis 10,000 次基线：SET 37,453.18 req/s、p50 1.087ms；GET 54,644.81 req/s、p50 0.791ms；Lua INCR+HSET+XADD 30,487.80 req/s、p50 1.487ms。

### 100 用户负载

命令使用 `tests/performance/chat-load.js`，100 个独立账户/对话，100 VU，持续 15 分钟，每用户每 5 秒创建一次 generation；API、Outbox、BullMQ 和 Fake Worker 全链路同时运行。

- 17,900/17,900 次 generation 创建返回 202；
- 错误率 0，检查成功率 100%；
- generation 创建平均 29.05ms，p95 57.28ms，最大 120.82ms；
- 总 HTTP p95 57.20ms，吞吐 20.13 req/s；
- 结束时 17,900 个 Worker Job 全部完成，Outbox 为 0；BullMQ completed 保持 1,000，Redis 为 7,971 个键、11.80MiB；
- 达到 generation 创建 API p95 小于 300ms 的 SLO。

### 浏览器与长连接

- 恢复 p95 小于 2 秒；
- 长消息使用 CSS `content-visibility` 跳过不可见消息布局，Markdown 增量渲染有节流，完成后执行最终渲染；
- 已缓存对话切换和应用内部事件转发分别采样并断言 p95 小于 200ms；事件转发同时输出 Prometheus histogram；
- 100 条 SSE 持续 1,800,000ms（30 分钟），31 次内存采样，0 个流错误，接收 213,600 字节；RSS 从 424,755,200 字节降至 91,422,720 字节，峰值为首个样本，未发现持续增长或不可控缓冲。

## 阶段 10：安全、可观测性与运维

- API 和 Worker 已接入 OpenTelemetry Node SDK；API 延续入站 W3C `traceparent`，Worker generation span 使用同一结构化 trace 上下文；真实 OTLP HTTP 导出集成测试通过；
- Prometheus 指标包含 HTTP、generation、队列等待、outbox 年龄、供应商错误、heartbeat、事件转发延迟、Redis 客户端错误、SSE 连接数和进程内存；Dashboard 共 11 个面板；
- 告警规则共 10 条，覆盖 API/Generation 失败、Worker 静默、outbox、队列等待、401/402、heartbeat、事件转发 p95、Redis 连接错误和 RSS；本地接收器成功收到高优 firing 通知并返回 HTTP 204；
- `/metrics` 在 API 应用层仅允许回环、RFC1918 和 IPv6 私有/链路本地地址；
- `pnpm audit --audit-level high` 初次发现 2 个高危传递依赖，覆盖到修复版本后复扫为 0；
- Gitleaks 8.30.1 扫描 23 个提交及当前目录，结果为 0；历史 Nest 示例 token 和固定幂等 UUID使用精确值白名单，不放宽通用规则；
- Trivy 0.74.0 扫描 `pnpm-lock.yaml`、配置和秘密，HIGH/CRITICAL 结果为 0；无 Docker 环境通过临时空 `DOCKER_CONFIG` 直接下载公开漏洞库；
- PostgreSQL `pg_dump -Fc` 备份 1 秒，隔离数据库恢复 1 秒；12 张表、当时的 6 条迁移一致，备份 SHA-256 为 `95fe7182244136eff9163c9cce8a359a486bca46a7d1ec42f6f267fb35dabeab`；该历史迁移已于首次对外部署前压平为单一 baseline，原记录仅作为当时的验收证据；
- Redis 事件丢失、generation/worker/outbox 故障和供应商密钥轮换 runbook 已存在；CI 新增 Redis 服务、依赖审计、Gitleaks 与 Trivy 阻断检查。

## Docker 不可用时的操作方式

```bash
pnpm infra:native:up
pnpm test:e2e:prepare
pnpm test:e2e
pnpm infra:native:down
```

本机方案只绑定 `127.0.0.1:15432` 和 `127.0.0.1:16379`，停止服务不会删除 `.data/native`。生产发布仍应使用阶段 11 选定的托管 PostgreSQL/Redis 和镜像运行环境，不能把本机目录当作生产部署方案。
