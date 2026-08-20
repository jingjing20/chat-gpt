#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
POSTGRES_PORT="${POSTGRES_HOST_PORT:-15432}"
SOURCE_DATABASE="${DRILL_SOURCE_DATABASE:-chat_test}"
RESTORE_DATABASE="chat_restore_drill_$$"
DRILL_DIR="$(mktemp -d /private/tmp/chat-postgres-restore.XXXXXX)"
BACKUP_FILE="$DRILL_DIR/$SOURCE_DATABASE.dump"

cleanup() {
  if [[ "$RESTORE_DATABASE" == chat_restore_drill_* ]]; then
    dropdb -h 127.0.0.1 -p "$POSTGRES_PORT" -U postgres --if-exists "$RESTORE_DATABASE" >/dev/null
  fi
  rm -rf "$DRILL_DIR"
}
trap cleanup EXIT

bash "$ROOT_DIR/infra/native/up.sh" >/dev/null
backup_started=$SECONDS
pg_dump -h 127.0.0.1 -p "$POSTGRES_PORT" -U chat -Fc \
  -d "$SOURCE_DATABASE" -f "$BACKUP_FILE"
backup_seconds=$((SECONDS - backup_started))
backup_hash="$(shasum -a 256 "$BACKUP_FILE" | cut -d ' ' -f 1)"

restore_started=$SECONDS
createdb -h 127.0.0.1 -p "$POSTGRES_PORT" -U postgres -O chat "$RESTORE_DATABASE"
pg_restore -h 127.0.0.1 -p "$POSTGRES_PORT" -U chat \
  --exit-on-error --no-owner -d "$RESTORE_DATABASE" "$BACKUP_FILE"
restore_seconds=$((SECONDS - restore_started))

source_tables="$(psql -h 127.0.0.1 -p "$POSTGRES_PORT" -U chat -d "$SOURCE_DATABASE" -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
restored_tables="$(psql -h 127.0.0.1 -p "$POSTGRES_PORT" -U chat -d "$RESTORE_DATABASE" -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
source_migrations="$(psql -h 127.0.0.1 -p "$POSTGRES_PORT" -U chat -d "$SOURCE_DATABASE" -tAc \
  'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')"
restored_migrations="$(psql -h 127.0.0.1 -p "$POSTGRES_PORT" -U chat -d "$RESTORE_DATABASE" -tAc \
  'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')"

if [ "$source_tables" != "$restored_tables" ] || [ "$source_migrations" != "$restored_migrations" ]; then
  echo "恢复验证失败：表或迁移数量不一致" >&2
  exit 1
fi

echo "PostgreSQL 恢复演练通过：backup=${backup_seconds}s restore=${restore_seconds}s tables=${restored_tables} migrations=${restored_migrations} sha256=${backup_hash}"
