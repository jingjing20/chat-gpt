# @chat/llm

标准化 LLM 供应商边界和 OpenAI-compatible 流式适配器。负责解析 data-only SSE、归一化 DeepSeek 的 reasoning/content/usage/finish 事件，并将供应商错误转换为不含敏感信息的领域错误。

此包不依赖数据库或任何应用层代码，也不记录请求消息和 API Key。自动化契约测试使用固定 SSE 样例，不会访问真实供应商。
