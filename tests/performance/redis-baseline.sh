#!/usr/bin/env bash
set -euo pipefail

REDIS_HOST_VALUE="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT_VALUE="${REDIS_PORT:-16379}"
REQUESTS="${REDIS_BENCHMARK_REQUESTS:-10000}"

redis-benchmark -h "$REDIS_HOST_VALUE" -p "$REDIS_PORT_VALUE" \
  -q -n "$REQUESTS" -c 50 -t set,get
redis-benchmark -h "$REDIS_HOST_VALUE" -p "$REDIS_PORT_VALUE" \
  -q -n "$REQUESTS" -c 50 eval \
  "local n=redis.call('INCR',KEYS[1]); redis.call('HSET',KEYS[2],'sequence',n); redis.call('XADD',KEYS[3],'*','sequence',n); return n" \
  3 chat:perf:sequence chat:perf:state chat:perf:stream
redis-cli -h "$REDIS_HOST_VALUE" -p "$REDIS_PORT_VALUE" \
  del chat:perf:sequence chat:perf:state chat:perf:stream >/dev/null
