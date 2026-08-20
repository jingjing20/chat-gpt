#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DATA_DIR="$ROOT_DIR/.data/native"
POSTGRES_DATA="$DATA_DIR/postgres"
POSTGRES_SOCKET="$DATA_DIR/postgres-socket"
REDIS_DATA="$DATA_DIR/redis"
POSTGRES_PORT="${POSTGRES_HOST_PORT:-15432}"
REDIS_PORT="${REDIS_HOST_PORT:-16379}"

for command_name in initdb pg_ctl psql createdb redis-server redis-cli; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "缺少本机命令：$command_name" >&2
    exit 1
  fi
done

mkdir -p "$POSTGRES_DATA" "$POSTGRES_SOCKET" "$REDIS_DATA"

if [ ! -f "$POSTGRES_DATA/PG_VERSION" ]; then
  initdb -D "$POSTGRES_DATA" -A trust -U postgres --no-locale -E UTF8 >/dev/null
fi

if ! pg_ctl -D "$POSTGRES_DATA" status >/dev/null 2>&1; then
  pg_ctl -D "$POSTGRES_DATA" \
    -l "$DATA_DIR/postgres.log" \
    -o "-h 127.0.0.1 -p $POSTGRES_PORT -k $POSTGRES_SOCKET" \
    start >/dev/null
fi

if ! psql -h 127.0.0.1 -p "$POSTGRES_PORT" -U postgres -d postgres -tAc \
  "SELECT 1 FROM pg_roles WHERE rolname = 'chat'" | grep -q 1; then
  psql -h 127.0.0.1 -p "$POSTGRES_PORT" -U postgres -d postgres \
    -c "CREATE ROLE chat LOGIN PASSWORD 'chat_local_password'" >/dev/null
fi

for database_name in chat chat_test; do
  if ! psql -h 127.0.0.1 -p "$POSTGRES_PORT" -U postgres -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$database_name'" | grep -q 1; then
    createdb -h 127.0.0.1 -p "$POSTGRES_PORT" -U postgres -O chat "$database_name"
  fi
done

if ! redis-cli -h 127.0.0.1 -p "$REDIS_PORT" ping >/dev/null 2>&1; then
  redis-server \
    --bind 127.0.0.1 \
    --port "$REDIS_PORT" \
    --dir "$REDIS_DATA" \
    --dbfilename dump.rdb \
    --appendonly yes \
    --daemonize yes \
    --pidfile "$DATA_DIR/redis.pid" \
    --logfile "$DATA_DIR/redis.log"
fi

for _ in {1..100}; do
  if pg_isready -h 127.0.0.1 -p "$POSTGRES_PORT" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
if ! pg_isready -h 127.0.0.1 -p "$POSTGRES_PORT" >/dev/null 2>&1; then
  echo "PostgreSQL 启动后未在限定时间内就绪" >&2
  exit 1
fi

for _ in {1..100}; do
  redis_status="$(redis-cli --raw -h 127.0.0.1 -p "$REDIS_PORT" ping 2>/dev/null | tr -d '\r' || true)"
  if [ "$redis_status" = "PONG" ]; then
    break
  fi
  sleep 0.1
done
if [ "${redis_status:-}" != "PONG" ]; then
  echo "Redis 启动后未在限定时间内就绪" >&2
  exit 1
fi

echo "PostgreSQL 已就绪：127.0.0.1:${POSTGRES_PORT}（chat / chat_test）"
echo "Redis 已就绪：127.0.0.1:${REDIS_PORT}"
