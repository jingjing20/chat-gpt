# @chat/web

Next.js Web 应用，负责路由、渲染、浏览器状态以及 HTTP/SSE 客户端。浏览器端禁止接收数据库凭据、LLM 供应商密钥或其他服务端秘密。

## 本地运行

```bash
pnpm --filter @chat/web dev
```

默认访问地址为 `http://localhost:3000`，API 地址由 `NEXT_PUBLIC_API_BASE_URL` 指定。

阶段 1 只交付后端认证基础；登录页面和聊天布局属于阶段 2。
