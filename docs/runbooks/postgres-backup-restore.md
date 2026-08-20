# PostgreSQL 备份恢复演练

在隔离的可验证环境执行，目标库不得与开发或生产库同名。

1. 使用平台快照或 `pg_dump --format=custom` 创建加密备份并记录时间点与校验和。
2. 创建空的演练数据库，从备份恢复；禁止覆盖原库。
3. 运行迁移状态检查，并核对 users、conversations、messages、generations、outbox_events 数量。
4. 随机抽取 generation，验证最终消息、状态和用户作用域一致；不要把正文写入演练日志。
5. 运行 API 只读冒烟和跨用户拒绝测试，记录 RPO、RTO、备份校验和及结果。
6. 销毁演练数据库和临时凭据。

恢复失败时保留错误码和对象标识符，升级数据库值班人员；不得在原生产库反复尝试。

本机无 Docker 时可运行 `pnpm operations:postgres-restore`。脚本只从 `chat_test`
备份到 `/private/tmp`，恢复到带进程号的 `chat_restore_drill_*` 隔离数据库，校验表和
迁移数量后自动清理，不覆盖源库。
