# 阶段 2 验收记录

## 交付范围

- Prisma `Conversation`、`ConversationUserState`、`Message` 模型及独立迁移。
- 对话创建、列表、详情、重命名、归档、已读和滚动位置接口。
- 以创建时间和消息 ID 组成的不透明游标分页。
- 用户消息与固定 assistant 消息的事务持久化，不连接模型或 Worker。
- Next.js 登录/注册页、主布局、侧边栏、聊天页、输入框和长列表加载。
- TanStack Query 集中缓存键以及创建、改名、归档、发消息后的精确失效策略。
- `react-markdown`、`rehype-sanitize` 和禁用原始 HTML 组成的安全渲染边界。
- 对话级滚动位置延迟保存与刷新恢复。

## 数据隔离与分页性质

- 每个对话创建时同时写入所有者的 `ConversationUserState`。
- 对话、消息和状态的每次读取或写入都同时限定已认证用户与对话 ID。
- 跨用户访问详情、消息、改名、发消息和滚动位置均返回 `404 NOT_FOUND`。
- 消息按 `createdAt DESC, id DESC` 排序；游标同时携带这两个值，避免相同时间戳造成重复或遗漏。
- 归档只更新当前用户状态，默认列表明确限定 `archivedAt IS NULL`。

## 安全渲染

- Markdown 原始 HTML 被忽略，随后再经过允许列表清理。
- 组件测试覆盖 `<script>`、事件属性和 `javascript:` 链接。
- Chrome E2E 从注册、新建对话、发送恶意 Markdown 一直覆盖到页面刷新，并断言脚本未执行、危险节点未进入 DOM、消息仍可读取。

## 验证命令

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

应用迁移后，E2E 会顺序运行 API、Worker 和 Web，避免共享 `chat_test` 数据库的清理操作互相干扰。Web E2E 使用本机 Chrome，并自动启动隔离的 API 与 Next.js 测试服务。

本地验收结果：

- 6 个 API、2 个 Worker、1 个 Web 单元/组件测试通过。
- 9 个 API、1 个 Worker、1 个 Chrome E2E 测试通过。
- Web、API、Worker 和共享包生产构建通过。
- 阶段 2 迁移已成功应用到开发库 `chat` 和测试库 `chat_test`。
