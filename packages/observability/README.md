# @chat/observability

共享结构化日志、内容脱敏、W3C Trace Context 和 Prometheus 文本指标实现。

日志字段只允许标识符、长度、耗时、状态和安全错误码。`content`、`prompt`、
`message`、Cookie、认证头、密码、密钥和 token 会被递归脱敏。
