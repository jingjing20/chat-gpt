CREATE TYPE "ScheduledTaskStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');
CREATE TYPE "ScheduledTaskCadence" AS ENUM ('DAILY', 'WEEKLY');

CREATE TABLE "scheduled_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "prompt" TEXT NOT NULL,
  "cadence" "ScheduledTaskCadence" NOT NULL,
  "status" "ScheduledTaskStatus" NOT NULL DEFAULT 'ACTIVE',
  "next_run_at" TIMESTAMPTZ(3),
  "last_run_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scheduled_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "scheduled_tasks_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE
);

CREATE INDEX "scheduled_tasks_user_id_status_next_run_at_idx" ON "scheduled_tasks"("user_id", "status", "next_run_at");
CREATE INDEX "scheduled_tasks_status_next_run_at_idx" ON "scheduled_tasks"("status", "next_run_at");
