ALTER TABLE "outbox_events"
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "locked_at" TIMESTAMPTZ(3),
  ADD COLUMN "lock_token" UUID,
  ADD COLUMN "dead_lettered_at" TIMESTAMPTZ(3);

CREATE INDEX "outbox_events_published_at_dead_lettered_at_next_attempt_at_created_at_idx"
  ON "outbox_events"("published_at", "dead_lettered_at", "next_attempt_at", "created_at");

DROP INDEX IF EXISTS "outbox_events_unpublished_created_at_idx";

CREATE INDEX "outbox_events_dispatchable_idx"
  ON "outbox_events"("next_attempt_at", "created_at")
  WHERE "published_at" IS NULL AND "dead_lettered_at" IS NULL;
