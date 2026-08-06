# 本地开发运行手册

## 启动

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm db:migrate:deploy
pnpm dev
```

Docker Compose 自动读取 `.env`。默认宿主机端口为 PostgreSQL `15432`、Redis `16379`，用于避开常见本地冲突。若端口已被占用，请选择空闲的 `POSTGRES_HOST_PORT` 或 `REDIS_HOST_PORT`，并同步更新连接 URL。

阶段 1 新增的 `ACCESS_TOKEN_SECRET` 至少为 32 个字符。生产环境必须使用独立随机值，并将 `AUTH_COOKIE_SECURE` 设置为 `true`。

阶段 2 的 Web 默认通过 `API_INTERNAL_URL=http://localhost:3001` 在服务端代理 `/api/v1`。浏览器客户端始终使用同源相对地址，不要把内部 API 地址或任何密钥放入前端代码。

## 验证基础设施

```bash
docker compose -f infra/compose/compose.yml ps
docker compose -f infra/compose/compose.yml exec postgres pg_isready -U chat -d chat
docker compose -f infra/compose/compose.yml exec redis redis-cli ping
```

## 数据库迁移

```bash
pnpm db:generate
pnpm db:migrate:deploy
```

生产部署只使用 `db:migrate:deploy`。开发迁移命令 `db:migrate:dev` 会生成新迁移，只能在明确修改 Schema 时运行。

## 认证调用

客户端先调用 `GET /api/v1/auth/csrf`。后续写请求必须携带 Cookie，并把响应中的 `csrfToken` 放入 `x-csrf-token` 请求头。访问令牌和刷新令牌为 HttpOnly Cookie，不应由浏览器脚本读取。

## 阶段 2 聊天壳层

访问 `http://localhost:3000/login` 注册或登录。新建对话后，输入框会持久化用户消息并返回固定 assistant 消息；该阶段不会发起任何 LLM 请求。对话、消息、归档状态、已读时间和滚动位置都保存在 PostgreSQL，刷新页面后仍会恢复。

## E2E 测试

E2E 测试会清理用户、会话和审计记录，因此只能使用独立 `chat_test` 数据库。测试代码会校验数据库名称，不满足条件时立即停止。

首次在现有本地 PostgreSQL 容器中准备测试库：

```bash
docker compose -f infra/compose/compose.yml exec postgres createdb -U chat chat_test
DATABASE_URL="$TEST_DATABASE_URL" pnpm test:e2e:prepare
pnpm test:e2e
```

## 验证应用

```bash
curl http://localhost:3001/health/live
curl http://localhost:3001/health/ready
curl http://localhost:3002/health/live
curl http://localhost:3002/health/ready
```

API 的 `ready` 会验证配置和 PostgreSQL 连接；Worker 验证自身配置。阶段 3 可按 `apps/worker/README.md` 使用仅开发环境开放的入口显式执行真实供应商冒烟测试，默认自动化测试只使用固定流和 Fake Provider。

## 停止

```bash
pnpm infra:down
```

具名 Docker 数据卷会保留本地数据。正常停止命令不会删除数据卷。
