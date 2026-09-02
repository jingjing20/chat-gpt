-- 首次对外部署前压平的数据库基线；后续结构变更只允许追加迁移。
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "AuditAction" AS ENUM (
  'USER_REGISTERED',
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'SESSION_REFRESHED',
  'SESSION_REVOKED',
  'SESSION_REJECTED',
  'CONVERSATION_DELETED'
);
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCEEDED', 'FAILED');
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'STREAMING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "GenerationStatus" AS ENUM (
  'QUEUED',
  'STARTING',
  'STREAMING',
  'CANCEL_REQUESTED',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);
CREATE TYPE "GenerationAttemptStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" CITEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id" UUID NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "last_message_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_user_states" (
  "conversation_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  "last_read_at" TIMESTAMPTZ(3),
  "scroll_offset" INTEGER NOT NULL DEFAULT 0,
  "has_unread" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "conversation_user_states_pkey" PRIMARY KEY ("conversation_id", "user_id")
);

CREATE TABLE "messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "author_user_id" UUID,
  "role" "MessageRole" NOT NULL,
  "status" "MessageStatus" NOT NULL DEFAULT 'COMPLETED',
  "content" TEXT NOT NULL,
  "reasoning_content" TEXT,
  "parent_message_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "generations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "request_message_id" UUID NOT NULL,
  "response_message_id" UUID NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "model" VARCHAR(100) NOT NULL,
  "reasoning_enabled" BOOLEAN NOT NULL DEFAULT false,
  "status" "GenerationStatus" NOT NULL DEFAULT 'QUEUED',
  "last_sequence" BIGINT NOT NULL DEFAULT 0,
  "checkpoint_sequence" BIGINT NOT NULL DEFAULT 0,
  "idempotency_key" VARCHAR(100) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "finish_reason" VARCHAR(50),
  "provider_request_id" TEXT,
  "error_code" VARCHAR(100),
  "error_detail_safe" TEXT,
  "writer_token" UUID,
  "writer_heartbeat_at" TIMESTAMPTZ(3),
  "cancel_requested_at" TIMESTAMPTZ(3),
  "started_at" TIMESTAMPTZ(3),
  "first_token_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "generations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "generation_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "generation_id" UUID NOT NULL,
  "attempt_no" INTEGER NOT NULL,
  "status" "GenerationAttemptStatus" NOT NULL DEFAULT 'STARTED',
  "provider_request_id" TEXT,
  "writer_token" UUID,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMPTZ(3),
  "received_first_delta" BOOLEAN NOT NULL DEFAULT false,
  "http_status" INTEGER,
  "error_code" VARCHAR(100),
  CONSTRAINT "generation_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "usage_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "generation_id" UUID NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "model" VARCHAR(100) NOT NULL,
  "prompt_tokens" INTEGER,
  "completion_tokens" INTEGER,
  "total_tokens" INTEGER,
  "reasoning_tokens" INTEGER,
  "cache_hit_tokens" INTEGER,
  "cache_miss_tokens" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "aggregate_type" VARCHAR(50) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "type" VARCHAR(100) NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(500),
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(3),
  "lock_token" UUID,
  "dead_lettered_at" TIMESTAMPTZ(3),
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refresh_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "user_agent_hash" CHAR(64),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "rotated_from_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "action" "AuditAction" NOT NULL,
  "outcome" "AuditOutcome" NOT NULL,
  "request_id" VARCHAR(100) NOT NULL,
  "subject_id" VARCHAR(100),
  "ip_hash" CHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "conversations_owner_user_id_updated_at_id_idx"
  ON "conversations"("owner_user_id", "updated_at" DESC, "id" DESC);
CREATE INDEX "conversation_user_states_user_id_archived_at_updated_at_idx"
  ON "conversation_user_states"("user_id", "archived_at", "updated_at" DESC);
CREATE INDEX "messages_conversation_id_created_at_id_idx"
  ON "messages"("conversation_id", "created_at" DESC, "id" DESC);
CREATE UNIQUE INDEX "generations_request_message_id_key" ON "generations"("request_message_id");
CREATE UNIQUE INDEX "generations_response_message_id_key" ON "generations"("response_message_id");
CREATE UNIQUE INDEX "generations_user_id_idempotency_key_key"
  ON "generations"("user_id", "idempotency_key");
CREATE INDEX "generations_user_id_status_created_at_idx"
  ON "generations"("user_id", "status", "created_at");
CREATE INDEX "generations_conversation_id_created_at_idx"
  ON "generations"("conversation_id", "created_at");
CREATE INDEX "generations_status_writer_heartbeat_at_idx"
  ON "generations"("status", "writer_heartbeat_at");
CREATE UNIQUE INDEX "generation_attempts_generation_id_attempt_no_key"
  ON "generation_attempts"("generation_id", "attempt_no");
CREATE INDEX "usage_records_generation_id_created_at_idx"
  ON "usage_records"("generation_id", "created_at");
CREATE INDEX "outbox_events_published_at_created_at_idx"
  ON "outbox_events"("published_at", "created_at");
CREATE INDEX "outbox_events_published_at_dead_lettered_at_next_attempt_at_idx"
  ON "outbox_events"("published_at", "dead_lettered_at", "next_attempt_at", "created_at");
-- Prisma Schema 目前无法声明部分索引，该索引需要在迁移中显式维护。
CREATE INDEX "outbox_events_dispatchable_idx"
  ON "outbox_events"("next_attempt_at", "created_at")
  WHERE "published_at" IS NULL AND "dead_lettered_at" IS NULL;
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");
CREATE UNIQUE INDEX "refresh_sessions_rotated_from_id_key" ON "refresh_sessions"("rotated_from_id");
CREATE INDEX "refresh_sessions_user_id_revoked_at_expires_at_idx"
  ON "refresh_sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at" DESC);
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_user_states"
  ADD CONSTRAINT "conversation_user_states_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_user_states"
  ADD CONSTRAINT "conversation_user_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_author_user_id_fkey"
  FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_parent_message_id_fkey"
  FOREIGN KEY ("parent_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "generations"
  ADD CONSTRAINT "generations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generations"
  ADD CONSTRAINT "generations_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generations"
  ADD CONSTRAINT "generations_request_message_id_fkey"
  FOREIGN KEY ("request_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generations"
  ADD CONSTRAINT "generations_response_message_id_fkey"
  FOREIGN KEY ("response_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generation_attempts"
  ADD CONSTRAINT "generation_attempts_generation_id_fkey"
  FOREIGN KEY ("generation_id") REFERENCES "generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_records"
  ADD CONSTRAINT "usage_records_generation_id_fkey"
  FOREIGN KEY ("generation_id") REFERENCES "generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_sessions"
  ADD CONSTRAINT "refresh_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_sessions"
  ADD CONSTRAINT "refresh_sessions_rotated_from_id_fkey"
  FOREIGN KEY ("rotated_from_id") REFERENCES "refresh_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
