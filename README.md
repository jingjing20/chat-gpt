# 并发聊天系统

面向生产环境的多对话流式 AI 聊天应用。仓库按照 `docs/project-development-plan.md` 分阶段实施，每个阶段都可独立验证。

## 仓库结构

```text
apps/web       Next.js Web 应用
apps/api       NestJS REST API 与用户事件网关
apps/worker    NestJS 生成任务 Worker
packages/*     共享契约、配置、数据库及领域包
infra/         本地与生产基础设施定义
docs/          架构决策和运行手册
```

## 环境要求

- Node.js 22+
- pnpm 9.15.x
- Docker Compose v2

## 首次启动

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm db:migrate:deploy
pnpm dev
```

默认本地端点：

- Web：`http://localhost:3000`
- API 健康检查：`http://localhost:3001/health/live`
- Worker 健康检查：`http://localhost:3002/health/live`
- PostgreSQL：`localhost:15432`
- Redis：`localhost:16379`

非标准宿主机端口用于避免与已有数据库冲突。若端口已被占用，请同时修改 `.env` 中的端口变量和对应连接 URL。

阶段 3 之前无需提供 LLM API Key。自动化测试禁止调用付费外部接口。

## 验证

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

E2E 测试必须使用独立的 `chat_test` 数据库，禁止连接开发库或生产库。

## 安全

禁止提交 `.env`、供应商密钥、Cookie、访问令牌、刷新令牌、用户提示词或生成内容。`.env.example` 只用于声明配置结构和提供说明。
