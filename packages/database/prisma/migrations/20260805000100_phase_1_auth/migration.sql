CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "AuditAction" AS ENUM (
  'USER_REGISTERED',
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'SESSION_REFRESHED',
  'SESSION_REVOKED',
  'SESSION_REJECTED'
);
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCEEDED', 'FAILED');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" CITEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");
CREATE UNIQUE INDEX "refresh_sessions_rotated_from_id_key" ON "refresh_sessions"("rotated_from_id");
CREATE INDEX "refresh_sessions_user_id_revoked_at_expires_at_idx" ON "refresh_sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at" DESC);
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

ALTER TABLE "refresh_sessions"
  ADD CONSTRAINT "refresh_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_sessions"
  ADD CONSTRAINT "refresh_sessions_rotated_from_id_fkey"
  FOREIGN KEY ("rotated_from_id") REFERENCES "refresh_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
