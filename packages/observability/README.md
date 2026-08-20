# @chat/observability

共享结构化日志、内容脱敏、W3C Trace Context、OpenTelemetry OTLP trace 和
Prometheus 文本指标实现。

日志字段只允许标识符、长度、耗时、状态和安全错误码。`content`、`prompt`、
`message`、Cookie、认证头、密码、密钥和 token 会被递归脱敏。

本地开发默认使用 `OTEL_SDK_DISABLED=true`，避免在未启动 Collector 时产生无效
网络请求。需要导出 trace 时设置 `OTEL_SDK_DISABLED=false`，并通过
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` 指向 OTLP HTTP traces 端点。API 会从入站
`traceparent` 继续链路，Worker 会为每个生成任务创建独立 span。
