# @chat/database

该包拥有 Prisma 数据模型、迁移和数据库客户端类型。应用层只能通过该包访问 ORM，传输契约不得导入这里的类型。

常用命令（从仓库根目录执行）：

```bash
pnpm --filter @chat/database db:generate
pnpm --filter @chat/database db:migrate:deploy
pnpm --filter @chat/database db:migrate:dev
```

迁移命令读取根目录 `.env` 中的 `DATABASE_URL`。生产部署使用 `db:migrate:deploy`，不要在生产环境运行交互式开发迁移。

阶段 4 增加 `generations`、`generation_attempts`、`usage_records` 和 `outbox_events`。创建 generation 时，用户消息、assistant 占位、generation 和 outbox 必须在同一事务中写入。
