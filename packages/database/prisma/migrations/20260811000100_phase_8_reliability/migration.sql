ALTER TABLE "generations"
  ADD COLUMN "writer_token" UUID,
  ADD COLUMN "writer_heartbeat_at" TIMESTAMPTZ(3);

ALTER TABLE "generation_attempts"
  ADD COLUMN "writer_token" UUID;

CREATE INDEX "generations_status_writer_heartbeat_at_idx"
  ON "generations"("status", "writer_heartbeat_at");
