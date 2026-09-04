ALTER TABLE "scheduled_tasks"
  ADD COLUMN "time_of_day" VARCHAR(5) NOT NULL DEFAULT '09:00',
  ADD COLUMN "timezone_offset_minutes" INTEGER NOT NULL DEFAULT 0;
