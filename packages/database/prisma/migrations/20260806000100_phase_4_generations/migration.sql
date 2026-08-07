CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'STREAMING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "GenerationStatus" AS ENUM ('QUEUED', 'STARTING', 'STREAMING', 'CANCEL_REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "GenerationAttemptStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED', 'CANCELLED');

ALTER TABLE "messages"
  ADD COLUMN "status" "MessageStatus" NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN "reasoning_content" TEXT,
  ADD COLUMN "parent_message_id" UUID,
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "completed_at" TIMESTAMPTZ(3);

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_parent_message_id_fkey"
  FOREIGN KEY ("parent_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "generations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "request_message_id" UUID NOT NULL,
  "response_message_id" UUID NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "model" VARCHAR(100) NOT NULL,
  "status" "GenerationStatus" NOT NULL DEFAULT 'QUEUED',
  "last_sequence" BIGINT NOT NULL DEFAULT 0,
  "checkpoint_sequence" BIGINT NOT NULL DEFAULT 0,
  "idempotency_key" VARCHAR(100) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "finish_reason" VARCHAR(50),
  "provider_request_id" TEXT,
  "error_code" VARCHAR(100),
  "error_detail_safe" TEXT,
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
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "generations_request_message_id_key" ON "generations"("request_message_id");
CREATE UNIQUE INDEX "generations_response_message_id_key" ON "generations"("response_message_id");
CREATE UNIQUE INDEX "generations_user_id_idempotency_key_key" ON "generations"("user_id", "idempotency_key");
CREATE INDEX "generations_user_id_status_created_at_idx" ON "generations"("user_id", "status", "created_at");
CREATE INDEX "generations_conversation_id_created_at_idx" ON "generations"("conversation_id", "created_at");
CREATE UNIQUE INDEX "generation_attempts_generation_id_attempt_no_key" ON "generation_attempts"("generation_id", "attempt_no");
CREATE INDEX "usage_records_generation_id_created_at_idx" ON "usage_records"("generation_id", "created_at");
CREATE INDEX "outbox_events_published_at_created_at_idx" ON "outbox_events"("published_at", "created_at");

ALTER TABLE "generations" ADD CONSTRAINT "generations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generations" ADD CONSTRAINT "generations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generations" ADD CONSTRAINT "generations_request_message_id_fkey" FOREIGN KEY ("request_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generations" ADD CONSTRAINT "generations_response_message_id_fkey" FOREIGN KEY ("response_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
