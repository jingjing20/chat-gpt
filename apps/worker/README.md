# @chat/worker

NestJS 后台 Worker，是唯一允许发起 LLM 生成请求的应用。阶段 3 提供供应商流解析的开发入口；任务队列与 generation 持久化将在后续阶段按计划加入。

开发环境配置 `LLM_API_KEY` 后，可以独立验证真实上游流（自动化测试不会调用真实供应商）：

```bash
curl -N http://localhost:3002/development/llm/stream \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"只回答：连接正常"}]}'
```

响应是逐行输出的标准化 NDJSON 事件。该路由在非开发环境返回 404，且不会输出或记录 API Key。

## 本地运行

```bash
pnpm --filter @chat/worker start:dev
```

默认健康检查端口为 `3002`。
