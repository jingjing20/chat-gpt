#!/usr/bin/env bash
set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  echo "缺少 psql，无法验证 PostgreSQL 查询计划。" >&2
  exit 1
fi

if [ -z "${TEST_DATABASE_URL:-}" ]; then
  echo "必须设置 TEST_DATABASE_URL。" >&2
  exit 1
fi

PSQL_DATABASE_URL="${TEST_DATABASE_URL%%\?*}"
PLAN_OUTPUT="$(psql "$PSQL_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/performance/query-plan.sql)"
echo "$PLAN_OUTPUT"

if ! grep -q 'messages_conversation_id_created_at_id_idx' <<<"$PLAN_OUTPUT"; then
  echo "消息分页未使用预期索引。" >&2
  exit 1
fi

if ! grep -q 'outbox_events_unpublished_created_at_idx' <<<"$PLAN_OUTPUT"; then
  echo "Outbox 查询未使用预期部分索引。" >&2
  exit 1
fi
