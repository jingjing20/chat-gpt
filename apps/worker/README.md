# @chat/worker

NestJS 后台 Worker，是唯一允许发起 LLM 生成请求的应用。当前阶段只提供存活和就绪检查；任务队列与供应商调用将在后续阶段按计划加入。

## 本地运行

```bash
pnpm --filter @chat/worker start:dev
```

默认健康检查端口为 `3002`。
