# @chat/test-utils

共享测试辅助工具。阶段 3 已提供可脚本化 `FakeLlmProvider`，支持延时增量、reasoning/content 分离、usage、指定位置失败和 AbortSignal 取消；后续阶段可直接用它验证 Worker，不需要访问真实模型供应商。
