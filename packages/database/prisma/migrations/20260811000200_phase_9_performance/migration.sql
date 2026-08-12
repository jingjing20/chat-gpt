-- Outbox 热路径只扫描尚未发布的少量记录，避免索引长期容纳历史行。
CREATE INDEX "outbox_events_unpublished_created_at_idx"
ON "outbox_events"("created_at")
WHERE "published_at" IS NULL;
