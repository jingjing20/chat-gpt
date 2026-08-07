# @chat/worker

NestJS 后台 Worker，是唯一允许发起 LLM 生成请求的应用。阶段 3 提供供应商流解析的开发入口；阶段 4 从 BullMQ 消费 generation，加载已完成消息作为上下文，并把尝试、用量、部分失败内容和最终状态写入 PostgreSQL。

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

自动化测试通过 Fake Provider 验证首 delta 前重试、首 delta 后部分失败和取消 Abort，绝不会调用真实供应商。
