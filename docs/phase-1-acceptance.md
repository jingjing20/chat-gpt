# 阶段 1 验收记录

## 交付范围

- Prisma 数据库包、`User`、`RefreshSession`、`AuditLog` 和初始迁移。
- 注册、登录、刷新、退出、`/me` 和 CSRF 初始化接口。
- Argon2id 密码哈希、短期 Access JWT、随机 Refresh Token 与事务轮换。
- HttpOnly、SameSite Cookie；生产环境可配置 Secure 属性。
- 双提交 Cookie CSRF 防护、认证 IP 限流、全局参数校验、统一错误结构和请求 ID。
- 用户作用域保护的占位资源，用于证明跨用户访问不会泄漏资源是否存在。
- API 就绪检查包含真实 PostgreSQL 探测。

## 安全性质

- 数据库只保存 Refresh Token 的 SHA-256 摘要，不保存令牌原文。
- 刷新操作通过条件更新撤销旧会话，并在同一事务中建立唯一后继会话。
- 已轮换或已退出的 Refresh Token 再次使用时返回 `401 UNAUTHENTICATED`。
- 跨用户资源访问返回 `404 NOT_FOUND`，避免资源枚举。
- 审计记录只包含用户、会话、请求标识和经过 HMAC 处理的 IP/邮箱标识，不包含密码、Cookie 或令牌原文。
- E2E 测试只能连接 `chat_test` 数据库；库名不匹配时测试立即失败。

## 验证命令

```bash
pnpm install --offline --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

本地验收结果：

- 6 个 API 单元测试与 2 个 Worker 单元测试通过。
- 5 个 API E2E 测试与 1 个 Worker E2E 测试通过。
- Web、API、Worker 和共享包生产构建通过。
- PostgreSQL 开发库与独立测试库迁移成功；开发库数据未被 E2E 清理。

## 本地基础设施状态

阶段 1 验收启动了本项目自己的 PostgreSQL 与 Redis 容器，继续使用宿主机端口 `15432` 和 `16379`。创建了独立 `chat_test` 数据库；原有 `chat` 开发库未被测试清理。
