# @chat/api

NestJS API 应用，负责认证、授权、REST 接口、同步和用户事件网关。耗时模型生成任务不得在本应用的 HTTP 请求生命周期内运行。

## 阶段 1 认证接口

```text
GET    /api/v1/auth/csrf
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
GET    /api/v1/protected-resources/{ownerId}
```

除安全读取请求外，写请求必须把 `chat_csrf` Cookie 的值放入 `x-csrf-token` 请求头。访问令牌和刷新令牌仅通过 HttpOnly Cookie 传输。

## 命令

```bash
pnpm --filter @chat/api start:dev
pnpm --filter @chat/api test
pnpm --filter @chat/api test:e2e
```

E2E 测试会清理数据，因此只允许连接名称为 `chat_test` 的专用数据库。

## 阶段 2 对话接口

```text
POST   /api/v1/conversations
GET    /api/v1/conversations?archived=false
GET    /api/v1/conversations/{conversationId}
PATCH  /api/v1/conversations/{conversationId}
POST   /api/v1/conversations/{conversationId}/archive
POST   /api/v1/conversations/{conversationId}/read
PUT    /api/v1/conversations/{conversationId}/scroll-position
GET    /api/v1/conversations/{conversationId}/messages?limit=30&cursor=...
POST   /api/v1/conversations/{conversationId}/messages
```

所有接口都从认证上下文取得用户 ID，并在数据库查询中限定所有者作用域。跨用户访问统一返回 `404 NOT_FOUND`。消息接口暂不调用模型：每条用户消息会在同一事务中得到一条固定 assistant 回复，用于验证持久化、分页和长列表 UI。
