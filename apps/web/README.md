# @chat/web

Next.js Web 应用，负责路由、渲染、浏览器状态以及 HTTP/SSE 客户端。浏览器端禁止接收数据库凭据、LLM 供应商密钥或其他服务端秘密。

## 本地运行

```bash
pnpm --filter @chat/web dev
```

默认访问地址为 `http://localhost:3000`。浏览器统一请求同源的 `/api/v1`，Next.js 服务端再通过 `API_INTERNAL_URL` 代理到 API，认证 Cookie 不需要跨域传输。

阶段 2 已交付登录/注册页、聊天主布局、对话侧边栏、消息游标分页、输入框、对话级滚动位置和安全 Markdown 渲染。消息发送只产生固定 assistant 回复，不连接任何模型。

## 测试

```bash
pnpm --filter @chat/web test
pnpm --filter @chat/web test:e2e
```

组件测试验证 Markdown 清理结果；Playwright 通过真实 Chrome 验证登录、持久化以及脚本、原始 HTML 和危险链接均不能执行。
