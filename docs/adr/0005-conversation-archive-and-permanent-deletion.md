# ADR-0005：对话归档与永久删除语义

- 状态：已接受
- 日期：2026-08-20

## 背景

原 API 计划把 `DELETE /conversations/{conversationId}` 定义为归档，但实现使用了独立的 `/archive` 动作接口。前端没有已归档对话的管理入口，也无法恢复或永久删除对话，导致归档后的资源只能继续占用存储。

## 决策

归档、恢复和永久删除使用不同的明确语义：

- `POST /conversations/{conversationId}/archive` 设置当前用户的 `archivedAt`；
- `POST /conversations/{conversationId}/restore` 清空当前用户的 `archivedAt`；
- `DELETE /conversations/{conversationId}` 永久删除对话及其级联数据。

永久删除只允许对话所有者操作，且对话必须已经归档。存在排队、启动、流式生成或取消中任务时拒绝删除。删除事务先清理相关 Outbox 事件，再删除对话，并写入不包含消息内容的审计记录。

Redis 中的生成事件属于有限保留的恢复数据，不是永久事实。数据库删除成功后，即使短期 Redis 键尚未到期，鉴权查询也不能再取得已删除的 PostgreSQL 资源。

## 影响

- 设置页可以统一展示、恢复和永久删除已归档对话。
- 消息、Generation、Attempt 和 UsageRecord 通过外键级联删除。
- 删除操作不可撤销，前端必须二次确认。
- 活动生成必须先进入终态，避免 Worker 与永久删除竞争。
- 审计记录只保留用户 ID、对话 ID、请求 ID、结果和时间。
