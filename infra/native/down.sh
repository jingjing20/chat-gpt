#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DATA_DIR="$ROOT_DIR/.data/native"
POSTGRES_DATA="$DATA_DIR/postgres"
REDIS_PORT="${REDIS_HOST_PORT:-16379}"

if [ -f "$POSTGRES_DATA/PG_VERSION" ] && pg_ctl -D "$POSTGRES_DATA" status >/dev/null 2>&1; then
  pg_ctl -D "$POSTGRES_DATA" stop -m fast >/dev/null
fi

if redis-cli -h 127.0.0.1 -p "$REDIS_PORT" ping >/dev/null 2>&1; then
  redis-cli -h 127.0.0.1 -p "$REDIS_PORT" shutdown nosave >/dev/null
fi

echo "本机测试基础设施已停止，数据仍保留在 .data/native。"
