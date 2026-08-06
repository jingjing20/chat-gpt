# 阶段 3 验收记录

## 交付范围

- 独立 `@chat/llm` 包，定义标准化请求、事件、用量、适配器与安全错误类型。
- OpenAI-compatible data-only SSE 解析与 DeepSeek 配置映射。
- reasoning、content、usage-only、finish、keep-alive、空行和 `[DONE]` 处理。
- HTTP、超时、断连、损坏流错误归一化，以及 AbortSignal 上游取消。
- 可脚本化 `@chat/test-utils` Fake Provider，支持延时、错误、部分输出与取消。
- Worker 仅开发环境开放的 NDJSON 流解析测试入口。

## 安全边界

- API Key 只由 Worker 配置读取，不进入 Web 配置、响应或日志。
- 自动化测试使用固定 SSE 和 Fake Provider，不访问真实供应商。
- 真实 DeepSeek 冒烟测试必须由开发者显式配置密钥并调用开发入口。

## 验证命令

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

本地验收结果：

- 12 个 LLM Adapter、3 个 Fake Provider、6 个 API、2 个 Worker 和 1 个 Web 单元/组件测试通过。
- 9 个 API、1 个 Worker 和 1 个 Chrome E2E 测试通过。
- Web、API、Worker 和全部共享包生产构建通过。
- 真实 DeepSeek 冒烟测试未自动执行；它需要开发者显式提供密钥。
