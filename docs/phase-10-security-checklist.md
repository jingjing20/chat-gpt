# 阶段 10 安全与运维检查记录

- Markdown 使用允许列表渲染，XSS E2E 覆盖脚本、事件属性和危险协议。
- Cookie 为 HttpOnly、SameSite=Lax；生产强制 Secure。状态变更请求经过 CSRF 校验。
- conversation、message、generation、event 和 usage 查询均以认证 user ID 限定；跨用户 E2E 必须全部返回拒绝或不可见。
- 认证入口具有 IP/账户维度限流，generation 具有用户和供应商并发上限。
- JSON 日志递归脱敏 Cookie、Authorization、密码、密钥、token、prompt、message 和 content。
- `/metrics` 只能由基础设施网络访问，不得经公网 ingress 暴露。
- CI 必须运行锁文件依赖审计、秘密扫描、Dockerfile/镜像扫描；高危发现阻断发布。
- PostgreSQL 恢复和告警触达属于环境演练，须记录日期、环境、RPO/RTO、接收人和结果后方可验收。
