# 阶段 10 安全与运维检查记录

- Markdown 使用允许列表渲染，XSS E2E 覆盖脚本、事件属性和危险协议。
- Cookie 为 HttpOnly、SameSite=Lax；生产强制 Secure。状态变更请求经过 CSRF 校验。
- conversation、message、generation、event 和 usage 查询均以认证 user ID 限定；跨用户 E2E 必须全部返回拒绝或不可见。
- 认证入口具有 IP/账户维度限流，generation 具有用户和供应商并发上限。
- JSON 日志递归脱敏 Cookie、Authorization、密码、密钥、token、prompt、message 和 content。
- `/metrics` 只能由基础设施网络访问，不得经公网 ingress 暴露。
- CI 运行锁文件依赖审计、Gitleaks 与 Trivy 文件系统扫描；阶段 11 构建镜像后再增加镜像扫描，高危发现阻断发布。
- 2026-08-20 本机演练：依赖高危 0，Gitleaks 泄漏 0，Trivy HIGH/CRITICAL 0。
- 2026-08-20 本机 PostgreSQL 演练：备份 1 秒、隔离恢复 1 秒，12 张表和 6 条迁移一致；本机测试 RPO 为备份开始时点，RTO 为 1 秒。
- 2026-08-20 本地告警演练：回环接收器收到 `ProviderCredentialOrBalanceFailure` firing 通知并返回 204；真实值班接收人属于阶段 11 环境配置。
