# ADR-0001：OpenAI 兼容的 Chat Completions 供应商边界

- 状态：已接受
- 日期：2026-08-04

## 背景

首个供应商为 DeepSeek，但产品的对话和流式系统不能与单一厂商耦合。DeepSeek 提供 OpenAI 兼容的 Chat Completions API 和纯数据 SSE 流。

## 决策

基于产品所需的 Chat Completions 子集定义标准化 `LlmProviderAdapter` 边界。供应商请求字段、响应块、错误、用量、推理增量和结束原因进入生成领域前必须被标准化。

Worker 是唯一允许调用供应商的组件。浏览器和 API 应用不能直接调用供应商。

## 影响

- DeepSeek 是首个适配器，不是领域模型。
- 供应商专属参数保留在适配器内部。
- 未来可加入 Responses API 适配器，无需重写对话或浏览器事件。
- “兼容”供应商的可选字段和错误仍可能不同，因此必须维护契约固定样本。
