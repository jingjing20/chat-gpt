CREATE TYPE "ScheduledTaskTrigger" AS ENUM ('MANUAL', 'SCHEDULED');
CREATE TYPE "ScheduledTaskRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

ALTER TABLE "scheduled_tasks"
  ADD COLUMN "execution_conversation_id" UUID;

ALTER TABLE "generations"
  ADD COLUMN "isolated_context" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "scheduled_task_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "generation_id" UUID NOT NULL,
  "trigger" "ScheduledTaskTrigger" NOT NULL,
  "scheduled_for" TIMESTAMPTZ(3),
  "status" "ScheduledTaskRunStatus" NOT NULL DEFAULT 'QUEUED',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "scheduled_task_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scheduled_task_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE,
  CONSTRAINT "scheduled_task_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "scheduled_task_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE,
  CONSTRAINT "scheduled_task_runs_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "generations"("id") ON DELETE CASCADE
);

ALTER TABLE "scheduled_tasks"
  ADD CONSTRAINT "scheduled_tasks_execution_conversation_id_fkey"
  FOREIGN KEY ("execution_conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "scheduled_task_runs_generation_id_key" ON "scheduled_task_runs"("generation_id");
CREATE UNIQUE INDEX "scheduled_task_runs_task_id_scheduled_for_key" ON "scheduled_task_runs"("task_id", "scheduled_for");
CREATE INDEX "scheduled_task_runs_task_id_created_at_idx" ON "scheduled_task_runs"("task_id", "created_at" DESC);
CREATE INDEX "scheduled_task_runs_user_id_created_at_idx" ON "scheduled_task_runs"("user_id", "created_at" DESC);
CREATE INDEX "scheduled_tasks_execution_conversation_id_idx" ON "scheduled_tasks"("execution_conversation_id");
