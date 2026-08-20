#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
POSTGRES_PORT="${POSTGRES_HOST_PORT:-15432}"
REDIS_PORT="${REDIS_HOST_PORT:-16379}"
MARKER_ID="native-restart-$PPID-$$"

bash "$ROOT_DIR/infra/native/up.sh" >/dev/null
psql -h 127.0.0.1 -p "$POSTGRES_PORT" -U chat -d chat_test -v ON_ERROR_STOP=1 <<SQL >/dev/null
CREATE TABLE IF NOT EXISTS reliability_restart_drill (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO reliability_restart_drill (id) VALUES ('$MARKER_ID');
SQL
redis-cli -h 127.0.0.1 -p "$REDIS_PORT" SET "chat:drill:$MARKER_ID" persisted >/dev/null
redis-cli -h 127.0.0.1 -p "$REDIS_PORT" SAVE >/dev/null

started_at=$SECONDS
bash "$ROOT_DIR/infra/native/down.sh" >/dev/null
if pg_isready -h 127.0.0.1 -p "$POSTGRES_PORT" >/dev/null 2>&1; then
  echo "PostgreSQL 停止故障未生效" >&2
  exit 1
fi
if redis-cli -h 127.0.0.1 -p "$REDIS_PORT" ping >/dev/null 2>&1; then
  echo "Redis 停止故障未生效" >&2
  exit 1
fi

bash "$ROOT_DIR/infra/native/up.sh" >/dev/null
recovery_seconds=$((SECONDS - started_at))
postgres_marker="$(psql -h 127.0.0.1 -p "$POSTGRES_PORT" -U chat -d chat_test -tAc \
  "SELECT id FROM reliability_restart_drill WHERE id = '$MARKER_ID'")"
redis_marker="$(redis-cli --raw -h 127.0.0.1 -p "$REDIS_PORT" GET "chat:drill:$MARKER_ID" | tr -d '\r')"
if [ "$postgres_marker" != "$MARKER_ID" ] || [ "$redis_marker" != "persisted" ]; then
  echo "服务恢复后持久化标记不完整：postgres=<$postgres_marker> redis=<$redis_marker> expected=<$MARKER_ID>" >&2
  exit 1
fi

psql -h 127.0.0.1 -p "$POSTGRES_PORT" -U chat -d chat_test -v ON_ERROR_STOP=1 \
  -c "DELETE FROM reliability_restart_drill WHERE id = '$MARKER_ID'" >/dev/null
redis-cli -h 127.0.0.1 -p "$REDIS_PORT" DEL "chat:drill:$MARKER_ID" >/dev/null

echo "Redis/PostgreSQL 重启故障注入通过，恢复耗时 ${recovery_seconds}s，持久化标记完整。"
